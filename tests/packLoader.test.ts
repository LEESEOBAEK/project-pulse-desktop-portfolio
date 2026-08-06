import { describe, expect, test } from "vitest";
import { createPack, BUILTIN_PLACEHOLDER } from "../src/mascot/packLoader";
import { sequencePngPack, staticImagePack } from "./fixtures/packs";

const BASE = "http://localhost/packs/sequence/";

describe("createPack — 매니페스트 검증", () => {
  test("pack_id가 없으면 거부한다", () => {
    expect(() => createPack({ states: {} }, BASE)).toThrow(/pack_id/);
  });

  test("states가 없으면 거부한다", () => {
    expect(() => createPack({ pack_id: "x" }, BASE)).toThrow(/states/);
  });

  test("png_sequence에 frame_template이 없으면 거부한다", () => {
    expect(() =>
      createPack(
        {
          pack_id: "x",
          states: { "01_sleep": { type: "png_sequence", frame_count: 3, fps: 8 } },
        },
        BASE,
      ),
    ).toThrow(/frame_template/);
  });

  test("svg에 src가 없으면 거부한다", () => {
    expect(() =>
      createPack(
        { pack_id: "x", states: { "01_sleep": { type: "svg" } } },
        BASE,
      ),
    ).toThrow(/src/);
  });
});

describe("createPack — 프레임 템플릿 해석", () => {
  test("{frame:03} 템플릿은 zero-pad된 절대 URL 배열이 된다", () => {
    const pack = createPack(sequencePngPack, BASE);
    const visual = pack.resolveState("01_sleep");
    if (visual.type !== "png_sequence") throw new Error("expected sequence");
    expect(visual.frames[0]).toBe(
      `${BASE}01_sleep/01_sleep_001.png`,
    );
    expect(visual.frames.length).toBe(8);
    expect(visual.fps).toBe(12);
    expect(visual.loop).toBe(true);
  });

  test("{frame} 템플릿은 pad 없이 해석된다", () => {
    const pack = createPack(
      {
        pack_id: "x",
        states: {
          a: {
            type: "png_sequence",
            frame_template: "a/{frame}.png",
            frame_count: 2,
            fps: 6,
          },
        },
      },
      BASE,
    );
    const visual = pack.resolveState("a");
    if (visual.type !== "png_sequence") throw new Error("expected sequence");
    expect(visual.frames).toEqual([`${BASE}a/1.png`, `${BASE}a/2.png`]);
  });

  test("단일 이미지 src는 baseUrl 기준으로 해석된다", () => {
    const pack = createPack(staticImagePack, BASE);
    const visual = pack.resolveState("01_sleep");
    if (visual.type === "png_sequence") throw new Error("expected single");
    expect(visual.src).toBe(`${BASE}sleep.png`);
  });
});

describe("createPack — 프레임 이벤트", () => {
  test("events가 진행률과 이름으로 해석된다", () => {
    const pack = createPack(
      {
        pack_id: "x",
        states: {
          throw: {
            type: "png_sequence",
            frame_template: "t/{frame}.png",
            frame_count: 8,
            fps: 12,
            events: [{ name: "work_panel_open", at: 0.65 }],
          },
        },
      },
      BASE,
    );
    const visual = pack.resolveState("throw");
    if (visual.type !== "png_sequence") throw new Error("expected sequence");
    expect(visual.events).toEqual([{ name: "work_panel_open", at: 0.65 }]);
  });

  test("events가 없으면 빈 배열", () => {
    const pack = createPack(sequencePngPack, BASE);
    const visual = pack.resolveState("01_sleep");
    if (visual.type !== "png_sequence") throw new Error("expected sequence");
    expect(visual.events).toEqual([]);
  });
});

describe("createPack — 프레임별 재생 시간(frame_ms)", () => {
  test("frame_ms 배열이 프레임 수와 일치하면 그대로 해석된다", () => {
    const pack = createPack(
      {
        pack_id: "x",
        states: {
          throw: {
            type: "png_sequence",
            frame_template: "t/{frame}.png",
            frame_count: 3,
            fps: 12,
            frame_ms: [280, 140, 180],
          },
        },
      },
      BASE,
    );
    const visual = pack.resolveState("throw");
    if (visual.type !== "png_sequence") throw new Error("expected sequence");
    expect(visual.frameMs).toEqual([280, 140, 180]);
  });

  test("길이가 안 맞으면 무시하고 fps 간격을 쓴다", () => {
    const pack = createPack(
      {
        pack_id: "x",
        states: {
          a: {
            type: "png_sequence",
            frame_template: "a/{frame}.png",
            frame_count: 3,
            fps: 12,
            frame_ms: [100],
          },
        },
      },
      BASE,
    );
    const visual = pack.resolveState("a");
    if (visual.type !== "png_sequence") throw new Error("expected sequence");
    expect(visual.frameMs).toBeUndefined();
  });
});

describe("createPack — zzz_overlay 플래그", () => {
  test("기본값은 true (내장 Zzz 효과 사용)", () => {
    const pack = createPack(sequencePngPack, BASE);
    expect(pack.zzzOverlay).toBe(true);
  });

  test("아트에 zz가 그려진 팩은 false로 내장 효과를 끈다", () => {
    const pack = createPack(
      {
        pack_id: "baked-zz",
        zzz_overlay: false,
        states: { a: { type: "svg", src: "a.svg" } },
      },
      BASE,
    );
    expect(pack.zzzOverlay).toBe(false);
  });
});

describe("createPack — fallback 강등", () => {
  test("누락 상태는 fallback_state로 강등된다", () => {
    const pack = createPack(staticImagePack, BASE);
    const visual = pack.resolveState("07_startup_management");
    if (visual.type === "png_sequence") throw new Error("expected single");
    expect(visual.src).toBe(`${BASE}idle.png`); // fallback: 03_ready_idle
  });

  test("fallback_state도 없으면 내장 placeholder를 쓴다", () => {
    const pack = createPack(
      { pack_id: "x", states: { a: { type: "svg", src: "a.svg" } } },
      BASE,
    );
    const visual = pack.resolveState("missing");
    if (visual.type === "png_sequence") throw new Error("expected single");
    expect(visual.src).toBe(BUILTIN_PLACEHOLDER);
  });
});

describe("createPack explicit frame files", () => {
  test("preserves frame order and explicit event frame", () => {
    const pack = createPack(
      {
        pack_id: "x",
        states: {
          remote: {
            type: "png_sequence",
            frame_files: ["remote/010.png", "remote/001.png"],
            fps: 12,
            events: [{ name: "system_scan_signal", at: 0.88, at_frame: 2 }],
          },
        },
      },
      BASE,
    );
    const visual = pack.resolveState("remote");
    if (visual.type !== "png_sequence") throw new Error("expected sequence");
    expect(visual.frames).toEqual([
      `${BASE}remote/010.png`,
      `${BASE}remote/001.png`,
    ]);
    expect(visual.events).toEqual([
      { name: "system_scan_signal", at: 0.88, atFrame: 2 },
    ]);
  });
});
