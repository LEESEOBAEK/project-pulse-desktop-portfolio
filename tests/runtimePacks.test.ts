import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createPack } from "../src/mascot/packLoader";

test("the public placeholder pack resolves every declared state", () => {
  const packId = "placeholder-svg";
  const dir = join(process.cwd(), "public", "packs", packId);
  const manifest = JSON.parse(
    readFileSync(join(dir, "manifest.json"), "utf8"),
  );
  const pack = createPack(manifest, `http://localhost/packs/${packId}/`);

  for (const stateId of pack.stateIds()) {
    const visual = pack.resolveState(stateId);
    const urls = visual.type === "png_sequence" ? visual.frames : [visual.src];
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      const relative = decodeURI(
        new URL(url).pathname.replace(`/packs/${packId}/`, ""),
      );
      expect(existsSync(join(dir, relative)), `${stateId}:${relative}`).toBe(
        true,
      );
    }
  }
});

describe("public pack fallback behavior", () => {
  test("unknown states resolve to the manifest fallback", () => {
    const manifest = JSON.parse(
      readFileSync(
        join(
          process.cwd(),
          "public",
          "packs",
          "placeholder-svg",
          "manifest.json",
        ),
        "utf8",
      ),
    );
    const pack = createPack(manifest, "http://localhost/packs/placeholder-svg/");
    expect(pack.resolveState("unknown-state")).toEqual(
      pack.resolveState(manifest.fallback_state),
    );
  });
});
