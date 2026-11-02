import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { githubApiOf } from "./channels";
import { removeScratchDirs, scratchDir } from "./repo.test-support";
import { stateHomeOf, type UpdateReach, updateLine } from "./update";

afterEach(removeScratchDirs);

const NPM_BINARY = "/usr/local/lib/node_modules/@cniska/agent-ship-darwin-arm64/agent-ship";

const TAP_FORMULA = "/repos/cniska/homebrew-tap/contents/Formula/agent-ship.rb";

const FORMULA = [
  'url "https://github.com/cniska/agent-ship/releases/download/v1.1.0/agent-ship-darwin-arm64.tar.gz"',
  'url "https://github.com/cniska/agent-ship/releases/download/v1.1.0/agent-ship-linux-x64.tar.gz"',
  "",
].join("\n");

const PACKUMENT = `${JSON.stringify({ "dist-tags": { latest: "1.1.0" } })}\n`;

type StandIn = { readonly url: string; readonly paths: string[]; stop(): Promise<void> };

function standIn(answer: (path: string) => Response | Promise<Response>): StandIn {
  const paths: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url);
      paths.push(pathname);
      return answer(pathname);
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, paths, stop: () => server.stop(true) };
}

function reach(url: string, overrides: Partial<UpdateReach> = {}): UpdateReach {
  return {
    program: "agent-ship",
    pkg: "@cniska/agent-ship",
    executable: NPM_BINARY,
    running: "1.0.0",
    stateHome: scratchDir(),
    off: false,
    registry: url,
    githubApi: url,
    limitMs: 1000,
    now: 1_000_000,
    ...overrides,
  };
}

describe("updateLine", () => {
  test("reads the install from the executable's path, and checks nothing for any other path", async () => {
    const server = standIn((path) => new Response(path === TAP_FORMULA ? FORMULA : PACKUMENT));
    try {
      const installs = {
        "/opt/homebrew/Cellar/agent-ship/1.0.0/bin/agent-ship": "brew upgrade agent-ship",
        [NPM_BINARY]: "npm update -g @cniska/agent-ship",
        "/usr/lib/node_modules/@cniska/agent-ship/node_modules/@cniska/agent-ship-linux-x64/agent-ship":
          "npm update -g @cniska/agent-ship",
        "/home/u/.bun/install/global/node_modules/@cniska/agent-ship-linux-x64/agent-ship":
          "bun update -g @cniska/agent-ship",
        "/home/u/.local/share/mise/installs/bun/1.4.2/bin/bun": null,
        "/home/u/.local/bin/agent-ship": null,
        "/home/u/project/node_modules/@cniska/agent-ship-linux-x64/agent-ship": null,
      };
      for (const [executable, command] of Object.entries(installs)) {
        const line = await updateLine(reach(server.url, { executable }));
        expect(line).toBe(
          command === null
            ? null
            : `agent-ship 1.1.0 is out (running 1.0.0): run ${command}; if you cannot, tell the user.`,
        );
      }
      expect(server.paths).toEqual([TAP_FORMULA, ...Array(3).fill("/@cniska%2fagent-ship")]);
    } finally {
      await server.stop();
    }
  });

  test("keeps a lookup past its time limit as that day's check, with no version", async () => {
    const server = standIn(() => Bun.sleep(5000).then(() => new Response(PACKUMENT)));
    try {
      const first = reach(server.url, { limitMs: 20 });
      expect(await updateLine(first)).toBeNull();
      const kept = JSON.parse(
        readFileSync(join(String(first.stateHome), "agent-ship", "update-check.json"), "utf8"),
      );
      expect(kept).toEqual({ checked: 1_000_000, install: "npm", latest: null });
      expect(await updateLine({ ...first, now: first.now + 60_000 })).toBeNull();
      expect(server.paths).toHaveLength(1);
    } finally {
      await server.stop();
    }
  });

  test("prints nothing for an answer it cannot read, and asks nothing when switched off", async () => {
    const server = standIn(() => new Response("not json"));
    try {
      expect(await updateLine(reach(server.url))).toBeNull();
      expect(await updateLine(reach(server.url, { off: true }))).toBeNull();
      expect(await updateLine(reach(server.url, { stateHome: null }))).toBeNull();
      expect(server.paths).toHaveLength(1);
    } finally {
      await server.stop();
    }
  });
});

describe("the update check's settings", () => {
  test("keep state under XDG_STATE_HOME, else ~/.local/state, else nowhere", () => {
    expect(stateHomeOf("/x/state", "/home/u")).toBe("/x/state");
    expect(stateHomeOf("", "/home/u")).toBe("/home/u/.local/state");
    expect(stateHomeOf(undefined, undefined)).toBeNull();
  });

  test("read GitHub's API at GITHUB_API_URL without a trailing slash, else api.github.com", () => {
    expect(githubApiOf("http://127.0.0.1:9/")).toBe("http://127.0.0.1:9");
    expect(githubApiOf(undefined)).toBe("https://api.github.com");
  });
});
