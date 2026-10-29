import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import {
  type Ran,
  type World,
  refusal,
  removeScratchDirs,
  runScript,
  spawned,
  world,
  write,
} from "./harness";

afterEach(removeScratchDirs);

const SYSTEM_PATH = "/usr/bin:/bin";

const TARGETS = ["darwin-arm64", "linux-x64"];

const HOST = `${process.platform}-${process.arch}`;

const STUB = "#!/bin/sh\nfor arg; do printf 'arg %s\\n' \"$arg\"; done\nexit 7\n";

const NO_BUILD_UNAME = '#!/bin/sh\ncase "$1" in -s) echo Plan9 ;; -m) echo mips ;; esac\n';

type Installed = { readonly w: World; readonly bin: string; readonly platformPackage: string };

function executable(dir: string, file: string, text: string): string {
  write(dir, file, text);
  chmodSync(join(dir, file), 0o755);
  return join(dir, file);
}

function stubTarball(w: World, artifacts: string, target: string): void {
  const staging = join(w.root, "staging", target);
  executable(staging, "agent-ship", STUB);
  const packed = spawnSync(
    "tar",
    ["-czf", join(artifacts, `agent-ship-${target}.tar.gz`), "-C", staging, "agent-ship"],
    { encoding: "utf8", env: { PATH: SYSTEM_PATH } },
  );
  if (packed.status !== 0) throw new Error(`tar exited ${packed.status}: ${packed.stderr}`);
}

function installed(): Installed {
  const w = world();
  const artifacts = join(w.root, "artifacts");
  mkdirSync(artifacts);
  for (const target of TARGETS) stubTarball(w, artifacts, target);
  const built = join(w.root, "npm");
  const ran = runScript(w, w.root, "build-npm.ts", { PATH: SYSTEM_PATH }, [artifacts, built]);
  if (ran.exitCode !== 0) throw new Error(`build-npm exited ${ran.exitCode}: ${ran.stderr}`);
  const prefix = join(w.root, "prefix");
  const modules = join(prefix, "lib", "node_modules", "@cniska");
  cpSync(join(built, "agent-ship"), join(modules, "agent-ship"), { recursive: true });
  const platformPackage = join(modules, `agent-ship-${HOST}`);
  cpSync(join(built, HOST), platformPackage, { recursive: true });
  const bin = join(prefix, "bin");
  mkdirSync(bin);
  symlinkSync(join(modules, "agent-ship", "bin", "agent-ship"), join(bin, "agent-ship"));
  return { w, bin, platformPackage };
}

function launch({ w, bin }: Installed, args: readonly string[], path = `${bin}:${SYSTEM_PATH}`): Ran {
  return spawned(w, w.root, join(bin, "agent-ship"), args, { PATH: path });
}

test("AC-36 the npm launcher runs its platform package's binary with no Bun on PATH, and refuses no_build_for_platform, platform_package_missing before a usage error, and binary_failed", () => {
  const ran = launch(installed(), ["status", "v1.0.0 --x"]);
  expect(ran).toEqual({ exitCode: 7, stdout: "arg status\narg v1.0.0 --x\n", stderr: "" });

  const noBuild = installed();
  const fakeBin = join(noBuild.w.root, "fake-bin");
  executable(fakeBin, "uname", NO_BUILD_UNAME);
  const refusedPlatform = refusal(launch(noBuild, ["--version"], `${fakeBin}:${noBuild.bin}:${SYSTEM_PATH}`));
  expect(refusedPlatform.code).toBe("no_build_for_platform");
  expect(refusedPlatform.message).toBe(
    "agent-ship ships no build for Plan9-mips, only darwin-arm64 and linux-x64",
  );

  const missing = installed();
  rmSync(missing.platformPackage, { recursive: true });
  expect(refusal(launch(missing, ["--version"])).code).toBe("platform_package_missing");
  expect(refusal(launch(missing, ["frobnicate"])).code).toBe("platform_package_missing");

  const broken = installed();
  chmodSync(join(broken.platformPackage, "agent-ship"), 0o644);
  expect(refusal(launch(broken, ["--version"])).code).toBe("binary_failed");
  chmodSync(join(broken.platformPackage, "agent-ship"), 0o755);
  expect(launch(broken, ["--version"])).toEqual({ exitCode: 7, stdout: "arg --version\n", stderr: "" });
});
