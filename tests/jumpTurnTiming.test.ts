import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPack } from "../src/mascot/packLoader";
import { MascotView } from "../src/mascot/MascotView";

function loadPublicPack() {
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
  return createPack(manifest, "http://localhost/packs/placeholder-svg/");
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("public placeholder state transitions", () => {
  test("panel and scan states can be selected without bundled character files", () => {
    const host = document.createElement("div");
    const view = new MascotView(host, loadPublicPack());

    view.showState("03_panel_open_jump_turn_left_spatial_clean", {
      crossfade: false,
    });
    expect(host.querySelector("img")?.getAttribute("src")).toContain(
      "03_panel_open_jump_turn_left_spatial_clean.svg",
    );

    view.showState("05_system_scan");
    expect(host.querySelector("img")?.getAttribute("src")).toContain(
      "05_system_scan.svg",
    );
  });
});
