/**
 * One command for local development: the Next.js app AND the Inngest dev
 * server that runs everything scheduled (collection, analysis, profiles).
 *
 *   npm run dev:all
 *
 * Without the job runner the app looks fine but nothing is ever collected, and
 * nothing logs an error — which is exactly the failure this exists to prevent.
 * Cross-platform without a new dependency: two children, prefixed output, and
 * both are stopped together on Ctrl+C.
 */
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";

const port = process.env.PORT ?? "3000";
const win = process.platform === "win32";

const services = [
  { name: "app ", cmd: "npx", args: ["next", "dev", "--turbo", "-p", port] },
  {
    name: "jobs",
    cmd: "npx",
    args: ["inngest-cli@latest", "dev", "-u", `http://localhost:${port}/api/inngest`],
  },
];

const children = services.map(({ name, cmd, args }) => {
  const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], shell: win });
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on("line", (line) => console.log(`[${name}] ${line}`));
  }
  child.on("exit", (code) => {
    console.log(`[${name}] exited (${code ?? "signal"}) — stopping the other service`);
    stopAll();
  });
  return child;
});

let stopping = false;
function stopAll() {
  if (stopping) return;
  stopping = true;
  for (const c of children) {
    if (c.pid === undefined || c.exitCode !== null) continue;
    // A shell wrapper hides the real process on Windows; kill the whole tree.
    if (win) spawnSync("taskkill", ["/pid", String(c.pid), "/T", "/F"]);
    else c.kill("SIGTERM");
  }
  setTimeout(() => process.exit(0), 500);
}
process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);

console.log(`App:  http://localhost:${port}`);
console.log("Jobs: http://localhost:8288  (Inngest dev UI — runs, events, cron)");
