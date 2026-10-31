import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { formulaTag } from "./channels";
import { recordOf } from "./coded-error";
import { notice, type NoticeReach } from "./notice";
import { removeScratchDirs, scratchDir } from "./repo.test-support";

afterEach(removeScratchDirs);

function url(tag: string, target: string): string {
  return `      url "https://github.com/o/r/releases/download/${tag}/tool-${target}.tar.gz"\n`;
}

describe("formulaTag", () => {
  test("reads the one tag every url names, with or without a version stanza", () => {
    expect(formulaTag(`class T\n${url("v1.2.3", "a")}${url("v1.2.3", "b")}end\n`)).toBe("v1.2.3");
    expect(formulaTag(`class T\n  version "1.2.3"\n${url("cli-v1.2.3", "a")}end\n`)).toBe("cli-v1.2.3");
  });

  test("reads no tag when the urls differ, name no release or are missing", () => {
    expect(formulaTag(`${url("v1.2.3", "a")}${url("v1.2.4", "b")}`)).toBeNull();
    expect(formulaTag(`  url "https://example.test/tool.tar.gz"\n`)).toBeNull();
    expect(formulaTag("class T\nend\n")).toBeNull();
  });
});

const UNHURRIED_MS = 10_000;

type Installed = { readonly root: string; readonly bin: string };

function installedAt(path: readonly string[], versionScript: string, root = scratchDir()): Installed {
  const program = join(root, ...path);
  mkdirSync(dirname(program), { recursive: true });
  writeFileSync(program, `#!/bin/sh\n${versionScript}\n`);
  chmodSync(program, 0o755);
  const bin = join(root, "bin");
  mkdirSync(bin);
  symlinkSync(program, join(bin, "tool"));
  return { root, bin };
}

function npmInstall(versionScript: string): Installed {
  return installedAt(["lib", "node_modules", "@scope", "tool", "tool"], versionScript);
}

function reach(
  installed: Installed,
  registry: string,
  limitMs: number,
  githubApi = "http://127.0.0.1:9",
): NoticeReach {
  return {
    home: join(installed.root, "home"),
    cacheDir: join(installed.root, "cache"),
    platform: "linux-x64",
    githubApi,
    limitMs,
    env: { PATH: installed.bin },
    registry,
    now: () => 1_000_000,
  };
}

function answering(): { readonly url: string; readonly requests: string[]; stop(): void } {
  const requests: string[] = [];
  const formula = `class Tool\n${url("v1.1.0", "darwin-arm64")}${url("v1.1.0", "linux-x64")}end\n`;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url);
      requests.push(pathname);
      if (pathname.endsWith("/releases/latest")) return Response.json({ tag_name: "v1.1.0" });
      if (pathname.includes("/contents/Formula/")) return new Response(formula);
      return Response.json({ "dist-tags": { latest: "1.1.0" } });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, requests, stop: () => server.stop(true) };
}

async function noticeAt(
  path: readonly string[],
  shaped: (installed: Installed) => Partial<NoticeReach> = () => ({}),
  receipt: string | null = null,
): Promise<{ readonly text: string | null; readonly requests: readonly string[] }> {
  const installed = installedAt(path, "echo 1.0.0");
  if (receipt !== null)
    writeFileSync(join(installed.root, ...path.slice(0, 4), "INSTALL_RECEIPT.json"), receipt);
  const server = answering();
  const text = await notice(ASKED, {
    ...reach(installed, server.url, UNHURRIED_MS, server.url),
    ...shaped(installed),
  });
  server.stop();
  return { text, requests: server.requests };
}

const UPGRADE = /by running: `(.*)` If/;

function upgradeIn(text: string | null): string | null {
  return UPGRADE.exec(text ?? "")?.[1] ?? null;
}

describe("notice reads the channel from the copy's real path", () => {
  test("a Cellar keg whose receipt names its tap is Homebrew, and one whose receipt names none is silent", async () => {
    const keg = ["opt", "Cellar", "tool", "1.0.0", "bin", "tool"];
    const tapped = await noticeAt(keg, () => ({}), '{"source":{"tap":"owner/tap"}}');
    expect(upgradeIn(tapped.text)).toBe("brew upgrade owner/tap/tool");
    const untapped = await noticeAt(keg, () => ({}), '{"source":{}}');
    expect(untapped).toEqual({ text: null, requests: [] });
    const unreceipted = await noticeAt(keg);
    expect(unreceipted).toEqual({ text: null, requests: [] });
  });

  test("bun and npm global installs, scoped or not, upgrade through their package manager", async () => {
    const bun = await noticeAt([
      "home",
      ".bun",
      "install",
      "global",
      "node_modules",
      "@scope",
      "tool",
      "tool",
    ]);
    expect(upgradeIn(bun.text)).toBe("bun add --global @scope/tool@latest");
    const npm = await noticeAt(["usr", "lib", "node_modules", "tool", "bin", "tool"]);
    expect(upgradeIn(npm.text)).toBe("npm install --global tool@latest");
    expect(npm.requests).toEqual(["/tool"]);
  });

  test("a copy in ~/.local/bin is a GitHub release only on a platform with a build", async () => {
    const path = ["home", ".local", "bin", "tool"];
    const release = await noticeAt(path);
    expect(upgradeIn(release.text)).toMatch(
      /^\(d=.* && tar -xzf tool-linux-x64\.tar\.gz && mv tool '\/[^']*\/home\/\.local\/bin\/tool'\)$/,
    );
    expect(release.requests).toEqual(["/repos/owner/tool/releases/latest"]);
    const unbuilt = await noticeAt(path, () => ({ platform: null }));
    expect(unbuilt).toEqual({ text: null, requests: [] });
    const linked = await noticeAt(["real-home", ".local", "bin", "tool"], ({ root }) => {
      symlinkSync(join(root, "real-home"), join(root, "linked-home"));
      return { home: join(root, "linked-home") };
    });
    expect(upgradeIn(linked.text)).toMatch(/&& mv tool '\/[^']*\/real-home\/\.local\/bin\/tool'\)$/);
    const homeless = await noticeAt(path, () => ({ home: null }));
    expect(homeless).toEqual({ text: null, requests: [] });
  });

  test("a checkout, a version manager or any other directory is silent and asks nothing", async () => {
    for (const path of [
      ["home", "code", "tool", "bin", "tool"],
      ["home", ".local", "share", "mise", "installs", "github-owner-tool", "1.0.0", "tool"],
      ["usr", "local", "bin", "tool"],
      ["home", ".local", "bin", "sub", "tool"],
    ])
      expect(await noticeAt(path)).toEqual({ text: null, requests: [] });
  });
});

function hanging(): { readonly url: string; readonly requests: string[]; stop(): void } {
  const requests: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      requests.push(new URL(request.url).pathname);
      return new Promise<Response>(() => {});
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, requests, stop: () => server.stop(true) };
}

const LIMIT_MS = 1000;

const ASKED = { program: "tool", repo: "owner/tool" };

describe("notice within its time limit", () => {
  test("gives up on a registry slower than the limit, silent, and records the timeout", async () => {
    const installed = npmInstall("echo 1.0.0");
    const registry = hanging();
    const started = performance.now();

    const text = await notice(ASKED, reach(installed, registry.url, LIMIT_MS));

    registry.stop();
    expect(text).toBeNull();
    expect(performance.now() - started).toBeLessThan(LIMIT_MS * 3);
    const record: unknown = JSON.parse(
      readFileSync(join(installed.root, "cache", "agent-ship", "notice", "tool.json"), "utf8"),
    );
    expect(record).toMatchObject({
      checked: 1_000_000,
      source: "npm @scope/tool",
      found: { kind: "failed", code: "timeout" },
    });
  });

  test("gives up on a program whose --version is slower than the limit, without asking the network", async () => {
    const installed = npmInstall("exec sleep 5");
    const registry = hanging();
    const started = performance.now();

    const text = await notice(ASKED, reach(installed, registry.url, LIMIT_MS));

    registry.stop();
    expect(text).toBeNull();
    expect(performance.now() - started).toBeLessThan(LIMIT_MS * 3);
    expect(registry.requests).toEqual([]);
  });
});

describe("notice's record", () => {
  test("a record it cannot write is the fault record_unwritable, naming the directory to make writable", async () => {
    const installed = npmInstall("echo 1.0.0");
    const server = answering();
    const records = join(installed.root, "cache", "agent-ship", "notice");
    mkdirSync(records, { recursive: true });
    chmodSync(records, 0o500);

    const asked = notice(ASKED, reach(installed, server.url, UNHURRIED_MS));

    const outcome = await asked.then(
      () => "kept",
      (error: unknown) => error,
    );
    server.stop();
    expect(recordOf(outcome)).toMatchObject({
      kind: "fault",
      code: "record_unwritable",
      meta: { path: join(records, "tool.json") },
      resolve: `make ${records} writable, or set XDG_CACHE_HOME to a writable directory, then run the command again`,
    });
    expect(server.requests).toEqual(["/@scope%2ftool"]);
  });
});
