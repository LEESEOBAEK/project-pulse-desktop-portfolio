import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  createRenderer,
  PngSequenceRenderer,
  SvgRenderer,
} from "../src/mascot/renderers";
import { MascotView } from "../src/mascot/MascotView";
import { createPack } from "../src/mascot/packLoader";
import { altCharacterPack } from "./fixtures/packs";
import type { ResolvedVisual } from "../src/mascot/packTypes";

const SEQ: ResolvedVisual = {
  type: "png_sequence",
  frames: ["http://x/1.png", "http://x/2.png", "http://x/3.png"],
  fps: 10,
  loop: false,
  holdMs: 200,
};

const LOOP_SEQ: ResolvedVisual = { ...SEQ, loop: true, holdMs: 0 };

function img(host: HTMLElement): HTMLImageElement {
  const el = host.querySelector("img");
  if (!el) throw new Error("no img mounted");
  return el;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createRenderer", () => {
  test("타입별로 올바른 어댑터를 만든다", () => {
    expect(createRenderer("png_sequence")).toBeInstanceOf(PngSequenceRenderer);
    expect(createRenderer("svg")).toBeInstanceOf(SvgRenderer);
    expect(createRenderer("static_image")).toBeInstanceOf(SvgRenderer);
  });
});

describe("PngSequenceRenderer", () => {
  test("fps 간격으로 프레임을 진행하고 holdMs 후 onComplete를 호출한다", () => {
    const host = document.createElement("div");
    const renderer = new PngSequenceRenderer();
    renderer.mount(host);
    const onComplete = vi.fn();
    renderer.render(SEQ, { onComplete });

    expect(img(host).src).toBe("http://x/1.png");
    vi.advanceTimersByTime(100);
    expect(img(host).src).toBe("http://x/2.png");
    vi.advanceTimersByTime(100);
    expect(img(host).src).toBe("http://x/3.png");
    expect(onComplete).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100 + 200); // 마지막 프레임 유지 + holdMs
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  test("loop 시퀀스는 처음으로 되감고 onComplete를 호출하지 않는다", () => {
    const host = document.createElement("div");
    const renderer = new PngSequenceRenderer();
    renderer.mount(host);
    const onComplete = vi.fn();
    renderer.render(LOOP_SEQ, { onComplete });

    vi.advanceTimersByTime(100 * 3);
    expect(img(host).src).toBe("http://x/1.png");
    expect(onComplete).not.toHaveBeenCalled();
  });

  test("stop 후에는 프레임이 진행되지 않는다", () => {
    const host = document.createElement("div");
    const renderer = new PngSequenceRenderer();
    renderer.mount(host);
    renderer.render(LOOP_SEQ);
    renderer.stop();
    vi.advanceTimersByTime(1000);
    expect(img(host).src).toBe("http://x/1.png");
  });

  test("startPaused는 첫 프레임에서 멈추고 resume 후 재생한다", () => {
    const host = document.createElement("div");
    const renderer = new PngSequenceRenderer();
    renderer.mount(host);
    renderer.render(LOOP_SEQ, { startPaused: true });

    vi.advanceTimersByTime(500);
    expect(img(host).src).toBe("http://x/1.png");

    renderer.resume();
    vi.advanceTimersByTime(100);
    expect(img(host).src).toBe("http://x/2.png");
  });

  test("direction reverse는 마지막 프레임부터 역순으로 재생한다", () => {
    const host = document.createElement("div");
    const renderer = new PngSequenceRenderer();
    renderer.mount(host);
    const onComplete = vi.fn();
    renderer.render(SEQ, { direction: "reverse", onComplete });

    expect(img(host).src).toBe("http://x/3.png");
    vi.advanceTimersByTime(100);
    expect(img(host).src).toBe("http://x/2.png");
    vi.advanceTimersByTime(100);
    expect(img(host).src).toBe("http://x/1.png");
    vi.advanceTimersByTime(300);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe("PngSequenceRenderer — 프레임별 재생 시간", () => {
  test("frameMs가 있으면 프레임마다 해당 시간만큼 표시한다", () => {
    const host = document.createElement("div");
    const renderer = new PngSequenceRenderer();
    renderer.mount(host);
    const onComplete = vi.fn();
    renderer.render(
      {
        type: "png_sequence",
        frames: ["http://x/1.png", "http://x/2.png", "http://x/3.png"],
        fps: 10,
        loop: false,
        holdMs: 0,
        interruptible: true,
        events: [],
        frameMs: [300, 100, 200],
      },
      { onComplete },
    );

    expect(img(host).src).toBe("http://x/1.png");
    vi.advanceTimersByTime(299);
    expect(img(host).src).toBe("http://x/1.png"); // 1번은 300ms 유지
    vi.advanceTimersByTime(1);
    expect(img(host).src).toBe("http://x/2.png");
    vi.advanceTimersByTime(100);
    expect(img(host).src).toBe("http://x/3.png");
    expect(onComplete).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200); // 3번 표시 시간 후 완료
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe("PngSequenceRenderer — 프레임 이벤트", () => {
  test("진행률 지점을 지나는 프레임에서 onEvent를 한 번 발화한다", () => {
    const host = document.createElement("div");
    const renderer = new PngSequenceRenderer();
    renderer.mount(host);
    const events: string[] = [];
    renderer.render(
      {
        type: "png_sequence",
        frames: Array.from({ length: 8 }, (_v, i) => `http://x/${i + 1}.png`),
        fps: 10,
        loop: false,
        holdMs: 0,
        interruptible: true,
        events: [{ name: "work_panel_open", at: 0.65 }],
      },
      { onEvent: (name) => events.push(name) },
    );

    // at 0.65 → floor(0.65 * (8-1)) = 4 → 0-기준 4번째(5번 프레임) 도달 시 발화
    vi.advanceTimersByTime(100 * 3);
    expect(events).toEqual([]);
    vi.advanceTimersByTime(100);
    expect(events).toEqual(["work_panel_open"]);
    vi.advanceTimersByTime(100 * 4);
    expect(events).toEqual(["work_panel_open"]); // 중복 발화 없음
  });
});

describe("SvgRenderer", () => {
  test("단일 이미지를 표시하고 일정 시간 후 onComplete를 호출한다", () => {
    const host = document.createElement("div");
    const renderer = new SvgRenderer();
    renderer.mount(host);
    const onComplete = vi.fn();
    renderer.render({ type: "svg", src: "http://x/a.svg" }, { onComplete });
    expect(img(host).src).toBe("http://x/a.svg");
    vi.advanceTimersByTime(400);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe("MascotView", () => {
  test("visual 타입이 바뀌면 렌더러를 교체하고 같은 host에 다시 마운트한다", () => {
    const host = document.createElement("div");
    const pack = createPack(altCharacterPack, "http://localhost/p/");
    const view = new MascotView(host, pack);

    view.showState("01_sleep"); // png_sequence
    expect(img(host).src).toContain("cat_sleep/1.png");

    view.showState("03_ready_idle"); // svg
    expect(img(host).src).toContain("03_ready_idle.svg");
    expect(host.querySelectorAll("img").length).toBe(1);

    view.showState("12_success"); // static_image
    expect(img(host).src).toContain("cat_success.png");
  });

  test("showState의 onComplete가 시퀀스 완료 시 호출된다", () => {
    const host = document.createElement("div");
    const pack = createPack(altCharacterPack, "http://localhost/p/");
    const view = new MascotView(host, pack);
    const onComplete = vi.fn();

    view.showState("02_wake_up", { onComplete }); // svg 팩 상태: 400ms 후 완료
    vi.advanceTimersByTime(400);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
