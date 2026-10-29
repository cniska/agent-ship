import { faults } from "./coded-error";
import type { ProcessEnv } from "./exec";

const fault = faults<{
  readonly workflow_input_invalid: { readonly variable: string; readonly problem: string };
}>({
  workflow_input_invalid: {
    message: ({ variable, problem }) => `${variable} ${problem}`,
    resolve: () => "run the script from the release workflow, which sets every variable it reads",
  },
});

export function invalidInput(variable: string, problem: string) {
  return fault("workflow_input_invalid", { variable, problem });
}

export function requiredInput(env: ProcessEnv, variable: string): string {
  const value = env[variable];
  if (value === undefined || value === "") throw invalidInput(variable, "is not set");
  return value;
}
