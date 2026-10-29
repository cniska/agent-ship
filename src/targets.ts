import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { refusals } from "./coded-error";
import type { ProcessEnv } from "./exec";
import { filesInput, requiredInput } from "./inputs";

type TargetInputs = { readonly targets: string; readonly files: readonly string[] };

type Merged = { readonly file: string; readonly targets: readonly string[] };

const refuse = refusals<{
  readonly target_files_conflict: { readonly file: string; readonly targets: readonly string[] };
}>({
  target_files_conflict: {
    message: ({ file, targets }) =>
      `the builds for ${targets.join(" and ")} each made ${file}, with different bytes`,
    resolve: ({ file }) =>
      "make the github-release channel's build write only the files of the target in TARGET, and move " +
      `${file} to its assemble command if it spans targets, then release a new version`,
  },
});

export function targetInputs(env: ProcessEnv): TargetInputs {
  return {
    targets: requiredInput(env, "TARGETS"),
    files: filesInput(env),
  };
}

function isFile(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isFile() === true;
}

function madeBy(targetsDir: string, targets: readonly string[], file: string): Merged {
  const makers = targets.filter((target) => isFile(join(targetsDir, target, file)));
  const [first, ...rest] = makers;
  if (first !== undefined) {
    const bytes = readFileSync(join(targetsDir, first, file));
    if (rest.some((target) => !bytes.equals(readFileSync(join(targetsDir, target, file)))))
      throw refuse("target_files_conflict", { file, targets: makers });
  }
  return { file, targets: makers };
}

export function mergeTargets(root: string, inputs: TargetInputs): readonly Merged[] {
  const targets = readdirSync(inputs.targets).toSorted();
  const merged = inputs.files.map((file) => madeBy(inputs.targets, targets, file));
  for (const { file, targets: makers } of merged) {
    const [maker] = makers;
    if (maker === undefined) continue;
    mkdirSync(dirname(join(root, file)), { recursive: true });
    copyFileSync(join(inputs.targets, maker, file), join(root, file));
  }
  return merged;
}
