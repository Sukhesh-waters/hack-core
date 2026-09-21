/**
 * Live provider check: which model actually answers, per tier, right now.
 *
 *   npx tsx scripts/verify-providers.ts
 *
 * Run it after rotating a key or when an AI step goes quiet. It calls each
 * provider directly (one tiny prompt each), then the router's ladders, so a
 * retired model id, a rotated key or an exhausted daily quota is named in
 * seconds instead of being inferred from an empty page.
 *
 * Costs a handful of tokens. Writes nothing.
 */
const PROMPT = "Reply with the single word: ok";

function line(label: string, detail: string) {
  console.log(`  ${label.padEnd(26)} ${detail}`);
}

async function main() {
  process.loadEnvFile(".env.local");
  const { routeChatWithProvenance, providerHealth, buildLadder, providerConfigured } =
    await import("@/lib/ai/router");

  console.log("\nKeys");
  for (const [name, key] of [
    ["GROQ_API_KEY", process.env.GROQ_API_KEY],
    ["NVIDIA_API_KEY", process.env.NVIDIA_API_KEY],
    ["GEMINI_API_KEY", process.env.GEMINI_API_KEY],
  ] as const) {
    line(name, key ? `set (${key.slice(0, 6)}…, ${key.length} chars)` : "NOT SET");
  }
  line("GEMINI_QUALITY_MODEL", process.env.GEMINI_QUALITY_MODEL ?? "(default)");
  line(
    "NVIDIA_CHAT_MODEL",
    process.env.NVIDIA_CHAT_MODEL ?? process.env.NVIDIA_NEMOTRON_MODEL ?? "(default)",
  );
  line("NVIDIA_EMBED_MODEL", process.env.NVIDIA_EMBED_MODEL ?? "(default)");

  const { runAsWorkload, providerCapacity } = await import("@/lib/ai/orchestration");

  console.log("\nLadders (configured providers, in order)");
  for (const tier of ["fast", "quality"] as const) {
    for (const workload of ["interactive", "background"] as const) {
      line(
        `${tier} / ${workload}`,
        buildLadder({ tier, workload }).join(" → ") || "(none configured)",
      );
    }
  }

  console.log("\nEach provider, called directly");
  let failures = 0;
  for (const provider of ["groq", "nvidia", "gemini", "bedrock"] as const) {
    if (!providerConfigured(provider)) {
      line(provider, "not configured — skipped");
      continue;
    }
    const started = Date.now();
    try {
      // Pinned: no fallback, so a failure here names the real culprit.
      const reply = await routeChatWithProvenance({
        kind: "chat",
        pin: provider,
        prompt: PROMPT,
      });
      line(
        provider,
        `OK — ${reply.model} in ${Date.now() - started}ms: "${reply.text.trim().slice(0, 40)}"`,
      );
    } catch (error) {
      failures += 1;
      line(provider, `FAILED — ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log("\nThrough the router (what the app actually gets)");
  for (const tier of ["fast", "quality"] as const) {
    try {
      const reply = await routeChatWithProvenance({ kind: "chat", tier, prompt: PROMPT });
      const head = buildLadder({ tier })[0];
      line(
        tier,
        `${reply.provider} / ${reply.model}` +
          (reply.provider === head ? "" : `  ← FELL BACK from ${head}`),
      );
    } catch (error) {
      failures += 1;
      line(tier, `FAILED — ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // What an Inngest job gets: the route wraps every job in this same context.
  try {
    const reply = await runAsWorkload("background", () =>
      routeChatWithProvenance({ kind: "chat", prompt: PROMPT }),
    );
    const head = buildLadder({ tier: "fast", workload: "background" })[0];
    line(
      "fast (as a background job)",
      `${reply.provider} / ${reply.model}` +
        (reply.provider === head ? "" : `  ← FELL BACK from ${head}`),
    );
  } catch (error) {
    failures += 1;
    line("background", `FAILED — ${error instanceof Error ? error.message : String(error)}`);
  }

  // Every Platina analysis call asks for JSON. A provider that answers prose
  // instead degrades silently: parseClaim/parseAttack fall back to raw text,
  // so the round still "works" while carrying nothing structured.
  console.log("\nJSON mode (every analysis call depends on it)");
  for (const provider of ["groq", "nvidia", "gemini"] as const) {
    if (!providerConfigured(provider)) continue;
    try {
      const reply = await routeChatWithProvenance({
        kind: "chat",
        pin: provider,
        json: true,
        system: "Reply with JSON only.",
        prompt: 'Return {"ok":true} and nothing else.',
      });
      let valid = true;
      try {
        JSON.parse(reply.text);
      } catch {
        valid = false;
      }
      line(
        provider,
        valid
          ? "OK — valid JSON"
          : `PROSE, not JSON: "${reply.text.trim().slice(0, 60).replace(/\n/g, " ")}"`,
      );
      if (!valid) failures += 1;
    } catch (error) {
      failures += 1;
      line(provider, `FAILED — ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Two spaces, checked separately. They are never a fallback for each other:
  // vectors from different models are not comparable.
  console.log("\nEmbedding spaces (retrieval depends on these)");
  const { routeAI } = await import("@/lib/ai/router");
  for (const space of ["gemini", "nvidia"] as const) {
    if (!providerConfigured(space)) {
      line(space, "not configured — skipped");
      continue;
    }
    const started = Date.now();
    try {
      const [vector] = await routeAI({ kind: "embed", texts: ["ok"], space });
      line(
        space,
        vector
          ? `OK — ${vector.length} dimensions in ${Date.now() - started}ms` +
              (space === "gemini" ? "  (what every stored vector uses)" : "  (not wired to storage)")
          : "FAILED — empty vector",
      );
      if (!vector) failures += 1;
    } catch (error) {
      failures += 1;
      line(space, `FAILED — ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const capacity = providerCapacity.snapshot();
  if (capacity.length > 0) {
    console.log("\nCapacity (from the provider's own rate-limit headers)");
    for (const entry of capacity) {
      line(
        entry.provider,
        `${entry.tokensLeft ?? "?"} of ${entry.tokenLimit ?? "?"} tokens left this minute, ` +
          `${entry.requestsLeft ?? "?"} requests left in the window`,
      );
    }
  }

  const cooling = providerHealth.snapshot();
  if (cooling.length > 0) {
    console.log("\nCooling down (the ladder will try these last)");
    for (const entry of cooling) line(entry.provider, `${entry.secondsLeft}s left`);
  }

  console.log(failures === 0 ? "\nAll good.\n" : `\n${failures} check(s) failed.\n`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

export {};
