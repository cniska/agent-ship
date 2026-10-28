#!/usr/bin/env bun
import { writeSync } from "node:fs";
import { encode } from "@toon-format/toon";

const PROGRAM = "agent-ship";

const STDOUT = 1;

const COMMANDS = [
  {
    name: "check",
    usage: `${PROGRAM} check [<app>]`,
    summary: "judge whether HEAD is ready to release, changing nothing",
  },
  {
    name: "release",
    usage: `${PROGRAM} release [<patch|minor|major|<version>>] [<app>] [--dry-run]`,
    summary: "bump the version, commit and tag the release, and print the push command",
  },
  {
    name: "status",
    usage: `${PROGRAM} status <tag>`,
    summary: "say whether each channel serves the tag's version",
  },
  {
    name: "doctor",
    usage: `${PROGRAM} doctor`,
    summary: "name each credential the channels need, whether it is set, and the fix for each one missing",
  },
];

writeSync(STDOUT, `${encode({ command: PROGRAM, ok: true, result: { commands: COMMANDS } })}\n`);
