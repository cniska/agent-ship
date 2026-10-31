import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ENTRY = join(import.meta.dir, "..", "src", "cli.ts");

const CLOCK = join(import.meta.dir, "clock.ts");

const FAILING = "FAILING";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`the launcher needs ${name}`);
  return value;
}

const registry = required("REGISTRY_STAND_IN");

const registryLog = required("REGISTRY_STAND_IN_LOG");

function answer(path: string): Response {
  if (existsSync(join(registry, FAILING))) return new Response("stand-in failure\n", { status: 503 });
  const file = join(registry, `${decodeURIComponent(path.slice(1))}.json`);
  if (!existsSync(file)) return new Response('{"error":"Not found"}\n', { status: 404 });
  return new Response(readFileSync(file, "utf8"), { headers: { "content-type": "application/json" } });
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const { pathname } = new URL(request.url);
    appendFileSync(registryLog, `${request.method} ${pathname}\n`);
    return answer(pathname);
  },
});

const child = Bun.spawn([process.execPath, "--preload", CLOCK, ENTRY, ...process.argv.slice(2)], {
  env: { ...process.env, npm_config_registry: `http://127.0.0.1:${server.port}` },
  stdio: ["inherit", "inherit", "inherit"],
});

const status = await child.exited;

await server.stop(true);

process.exit(status);
