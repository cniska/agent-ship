import { describe, expect, test } from "bun:test";
import { formulaTag } from "./channels";

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
