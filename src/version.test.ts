import { describe, expect, test } from "bun:test";
import * as fc from "fast-check";
import { bumpVersion, compareVersions, parseVersion, printVersion, tagOf, versionOfTag } from "./version";

const SEED = 20261029;

const part = fc.nat({ max: 2 ** 31 });

const version = fc.record({ major: part, minor: part, patch: part });

const level = fc.constantFrom("patch" as const, "minor" as const, "major" as const);

const prefix = fc.string({ maxLength: 12 });

describe("versions", () => {
  test("a bump is always newer than the version it bumps", () => {
    fc.assert(
      fc.property(version, level, (from, by) => compareVersions(bumpVersion(from, by), from) > 0),
      { seed: SEED },
    );
  });

  test("printing then parsing gives back the version", () => {
    fc.assert(
      fc.property(version, (shown) => {
        expect(parseVersion(printVersion(shown))).toEqual(shown);
      }),
      { seed: SEED },
    );
  });

  test("a tag made from a pattern parses back to its version", () => {
    fc.assert(
      fc.property(prefix, version, (tagPrefix, shown) => {
        expect(versionOfTag({ prefix: tagPrefix }, tagOf({ prefix: tagPrefix }, shown))).toEqual(shown);
      }),
      { seed: SEED },
    );
  });

  test("parses only plain major.minor.patch without leading zeros", () => {
    expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
    for (const text of ["01.2.3", "1.2", "v1.2.3", "1.2.3-rc.1", "1.2.3 ", "99999999999999999999.0.0"])
      expect(parseVersion(text)).toBeNull();
  });

  test("a bump resets the levels below it", () => {
    const from = { major: 1, minor: 4, patch: 7 };
    expect(bumpVersion(from, "patch")).toEqual({ major: 1, minor: 4, patch: 8 });
    expect(bumpVersion(from, "minor")).toEqual({ major: 1, minor: 5, patch: 0 });
    expect(bumpVersion(from, "major")).toEqual({ major: 2, minor: 0, patch: 0 });
  });

  test("a tag that does not carry the pattern's prefix has no version", () => {
    expect(versionOfTag({ prefix: "web-v" }, "cli-v1.0.0")).toBeNull();
    expect(versionOfTag({ prefix: "v" }, "v1.0")).toBeNull();
  });
});
