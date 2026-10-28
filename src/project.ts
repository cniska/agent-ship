import { unreachable } from "./assert";
import { type App, appsIn, type Config, loadConfig, type NamedApp } from "./config";
import type { ProcessEnv } from "./exec";
import { checkoutRoot, type Git } from "./git";
import { type Version, versionOfTag } from "./version";

export type Checkout = {
  readonly root: string;
  readonly env: ProcessEnv;
  readonly git: Git;
  readonly config: Config;
};

export type Project = Checkout & { readonly app: App };

export type AppChoice =
  | { readonly found: true; readonly app: App }
  | { readonly found: false; readonly problem: string };

export type TagChoice = { readonly app: App; readonly version: Version };

export function appOfTag(config: Config, tag: string): TagChoice | null {
  for (const app of appsIn(config)) {
    const version = versionOfTag(app.tag, tag);
    if (version !== null) return { app, version };
  }
  return null;
}

export function openCheckout(cwd: string, env: ProcessEnv): Checkout {
  const root = checkoutRoot(cwd, env);
  return { root, env, git: { root, env }, config: loadConfig(root) };
}

function names(apps: readonly NamedApp[]): string {
  return apps.map(({ name }) => name).join(", ");
}

export function chooseApp(config: Config, name: string | null): AppChoice {
  switch (config.kind) {
    case "single":
      if (name !== null) return { found: false, problem: `ship.toml names no apps, and got the app ${name}` };
      return { found: true, app: config.app };
    case "apps": {
      if (name === null) return { found: false, problem: `needs one of the apps ${names(config.apps)}` };
      const app = config.apps.find((candidate) => candidate.name === name);
      if (app === undefined)
        return { found: false, problem: `${name} is not one of the apps ${names(config.apps)}` };
      return { found: true, app };
    }
    default:
      return unreachable(config);
  }
}
