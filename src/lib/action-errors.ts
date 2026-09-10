/** Map raw server-action failures to safe, user-facing messages. */
export function actionErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Budget refusals are written for users — surface them verbatim.
  if (error instanceof Error && error.name === "AIBudgetError") {
    return message;
  }
  // Same for permission refusals. These name the action the person tried
  // ("Only an admin can change this workspace's workflow.") — collapsing
  // them into "Something went wrong" would turn a clear next step into a
  // support ticket.
  if (error instanceof Error && error.name === "PermissionError") {
    return message;
  }
  // Storage refusals name the missing config or the provider's own reason
  // ("Bucket not found") — collapsing them into "Something went wrong" hides
  // a one-line fix. Same rule as PermissionError above.
  if (error instanceof Error && error.name === "StorageError") {
    return message;
  }
  // Router failures name the provider so a dead key is diagnosable from the
  // UI instead of a generic "something went wrong" (degradation-honesty rule).
  if (error instanceof Error && error.name === "AIRouterError") {
    const { provider, status } = error as Error & {
      provider?: string;
      status?: number;
    };
    const who = provider ?? "AI provider";
    if (status === 400 || status === 401 || status === 403) {
      return `${who} rejected the request (${status}) — the API key is likely invalid or expired. Check .env.local.`;
    }
    if (status === 429) {
      return `${who} is rate-limited right now — try again in a minute.`;
    }
    return `${who} is unavailable${status ? ` (${status})` : ""} — try again shortly.`;
  }
  if (
    message.includes("DATABASE_URL") ||
    message.includes("database-not-configured") ||
    message.includes("ECONNREFUSED") ||
    message.includes("getaddrinfo")
  ) {
    return "Database isn't configured yet — set DATABASE_URL and run migrations, then retry.";
  }
  if (message.includes("duplicate key") || message.includes("unique")) {
    return "That slug is already taken — try another.";
  }
  if (message.includes("Unauthenticated")) {
    return "Your session expired. Sign in again.";
  }
  if (message.includes("Text too short") || message.includes("enough readable text")) {
    return "Extraction failed: the page contains too little readable text (e.g. client-side rendered SPA or login wall).";
  }
  if (
    message.includes("cannot be ingested") ||
    message.includes("too little readable text") ||
    message.includes("Extraction failed")
  ) {
    return message;
  }
  if (message.includes("Only HTML pages are supported")) {
    return "Only HTML webpages are supported for URL ingestion.";
  }
  if (message.includes("aborted due to timeout") || message.includes("TimeoutError")) {
    return "Request timed out. The website is taking too long to respond.";
  }
  if (message.includes("SSL routines") || message.includes("ERR_SSL_") || message.includes("TLSV1_")) {
    return "Secure connection failed (SSL/TLS error). The server might be blocking automated requests.";
  }
  return "Something went wrong. Please try again.";
}
