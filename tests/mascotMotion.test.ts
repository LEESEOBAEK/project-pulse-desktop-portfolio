// 모션 안정화 수정에 대한 테스트:
// 프리로드, 캔버스 비율, interruptible 큐잉, playChain 브리지 재생.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createPack, preloadPack } from "../src/mascot/packLoader";
import { MascotView } from "../src/mascot/MascotView";

const BASE = "http://localhost/packs/p/";

const MOTION_PACK = {
  pack_id: "motion-test",
  version: "1.0.0",
  canvas: { width: 400, height: 300 },
  fallback_state: "idle",
  states: {
    idle: {
      type: "png_sequence",
      frame_template: "idle/{frame}.png",
      frame_count: 2,
      fps: 10,
      loop: true,
    },
    cinematic: {
      type: "png_sequence",
      frame_template: "cine/{frame}.png",
      frame_count: 3,
      fps: 10,
      loop: false,
      hold_ms: 0,
      interruptible: false,
    },
    bridge: {
      type: "png_sequence",
      frame_template: "bridge/{frame}.png",
      frame_count: 2,
      fps: 10,
      loop: false,
      hold_ms: 0,
    },
    single: { type: "svg", src: "single.svg" },
  },
};

function img(host: HTMLElement): HTMLImageElement {
  const el = host.querySelector("img");
  if (!el) throw new Error("no img mounted");
  return el;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("preloadPack", () => {
  test("팩의 모든 프레임·이미지 URL을 중복 없이 프리로드한다", () => {
    const pack = createPack(MOTION_PACK, BASE);
    const urls = preloadPack(pack);
    expect(urls).toContain(`${BASE}idle/1.png`);
    expect(urls).toContain(`${BASE}cine/3.png`);
    expect(urls).toContain(`${BASE}bridge/2.png`);
    expect(urls).toContain(`${BASE}single.svg`);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.length).toBe(2 + 3 + 2 + 1);
  });
});

describe("createPack — stateIds와 interruptible", () => {
  test("stateIds가 매니페스트의 상태 목록을 돌려준다", () => {
    const pack = createPack(MOTION_PACK, BASE);
    expect(pack.stateIds().sort()).toEqual(
      ["bridge", "cinematic", "idle", "single"].sort(),
    );
  });

  test("interruptible은 기본 true, 명시하면 false", () => {
    const pack = createPack(MOTION_PACK, BASE);
    const cine = pack.resolveState("cinematic");
    const idle = pack.resolveState("idle");
    if (cine.type !== "png_sequence" || idle.type !== "png_sequence")
      throw new Error("expected sequences");
    expect(cine.interruptible).toBe(false);
    expect(idle.interruptible).toBe(true);
  });
});

describe("MascotView — 캔버스 비율", () => {
  test("host에 팩 캔버스 비율을 aspect-ratio로 적용한다", () => {
    const host = document.createElement("div");
    new MascotView(host, createPack(MOTION_PACK, BASE));
    expect(host.style.aspectRatio).toBe("400 / 300");
  });
});

describe("MascotView — interruptible 큐잉", () => {
  test("비중단 시퀀스 재생 중의 showState는 완료 후로 미뤄진다", () => {
    const host = document.createElement("div");
    const view = new MascotView(host, createPack(MOTION_PACK, BASE));

    view.showState("cinematic"); // 3프레임 @10fps, interruptible: false
    view.showState("idle"); // 재생 중 요청 → 대기
    expect(img(host).src).toContain("cine/1.png");

    vi.advanceTimersByTime(100); // frame 2
    expect(img(host).src).toContain("cine/2.png");

    vi.advanceTimersByTime(200); // t=300: 시퀀스 완료 → 대기 중이던 idle로 전환
    expect(img(host).src).toContain("idle/1.png");
  });

  test("대기 중 새 요청이 오면 마지막 요청만 재생된다", () => {
    const host = document.createElement("div");
    const view = new MascotView(host, createPack(MOTION_PACK, BASE));

    view.showState("cinematic");
    view.showState("idle");
    view.showState("bridge"); // idle 요청을 대체
    vi.advanceTimersByTime(300); // cinematic 완료 시점
    expect(img(host).src).toContain("bridge/1.png");
  });

  test("중단 가능 시퀀스는 즉시 교체된다", () => {
    const host = document.createElement("div");
    const view = new MascotView(host, createPack(MOTION_PACK, BASE));

    view.showState("idle");
    view.showState("bridge");
    expect(img(host).src).toContain("bridge/1.png");
  });
});

describe("MascotView — 전환 크로스페이드", () => {
  test("상태 전환 시 이전 프레임이 잠깐 잔상으로 남았다가 사라진다", () => {
    const host = document.createElement("div");
    const view = new MascotView(host, createPack(MOTION_PACK, BASE));

    view.showState("idle");
    view.showState("bridge");

    const ghost = host.querySelector<HTMLElement>(".mascot-fade");
    expect(ghost).toBeTruthy();
    expect(ghost!.style.backgroundImage).toContain("idle/1.png");
    expect(img(host).src).toContain("bridge/1.png");

    vi.advanceTimersByTime(300);
    expect(host.querySelector(".mascot-fade")).toBeNull();
  });

  test("첫 표시에는 잔상이 생기지 않는다", () => {
    const host = document.createElement("div");
    const view = new MascotView(host, createPack(MOTION_PACK, BASE));
    view.showState("idle");
    expect(host.querySelector(".mascot-fade")).toBeNull();
  });

  test("crossfadeMs로 이음새별 디졸브 길이를 지정할 수 있다", () => {
    const host = document.createElement("div");
    const view = new MascotView(host, createPack(MOTION_PACK, BASE));

    view.showState("idle");
    view.showState("bridge", { crossfadeMs: 450 });

    const ghost = host.querySelector<HTMLElement>(".mascot-fade");
    expect(ghost).toBeTruthy();
    expect(ghost!.style.animationDuration).toBe("450ms");

    vi.advanceTimersByTime(300);
    expect(host.querySelector(".mascot-fade")).toBeTruthy(); // 아직 디졸브 중
    vi.advanceTimersByTime(200);
    expect(host.querySelector(".mascot-fade")).toBeNull();
  });

  test("crossfade: false 옵션이면 잔상을 만들지 않는다", () => {
    const host = document.createElement("div");
    const view = new MascotView(host, createPack(MOTION_PACK, BASE));
    view.showState("idle");
    view.showState("bridge", { crossfade: false });
    expect(host.querySelector(".mascot-fade")).toBeNull();
  });

  test("playChain의 연결 지점은 설계된 연속 프레임이므로 잔상을 만들지 않는다", () => {
    const host = document.createElement("div");
    const view = new MascotView(host, createPack(MOTION_PACK, BASE));
    const onDone = vi.fn();

    view.playChain(["cinematic", "bridge"], { onDone });
    vi.advanceTimersByTime(300); // cinematic 완료 → bridge 시작 (체인 내부 전환)
    expect(img(host).src).toContain("bridge/1.png");
    expect(host.querySelector(".mascot-fade")).toBeNull();
  });
});

describe("MascotView — playChain", () => {
  test("체인을 순서대로 재생하고 loop 상태는 dwell 후 진행하며 끝나면 onDone", () => {
    const host = document.createElement("div");
    const view = new MascotView(host, createPack(MOTION_PACK, BASE));
    const onDone = vi.fn();

    view.playChain(["cinematic", "idle", "bridge"], {
      loopDwellMs: 500,
      onDone,
    });
    expect(img(host).src).toContain("cine/1.png");

    vi.advanceTimersByTime(300); // cinematic(3프레임) 완료 → idle 시작
    expect(img(host).src).toContain("idle/1.png");
    expect(onDone).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500); // loop dwell 경과 → bridge 시작
    expect(img(host).src).toContain("bridge/1.png");

    vi.advanceTimersByTime(200); // bridge(2프레임) 완료
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  test("playChain은 direction reverse를 각 시퀀스에 전달한다", () => {
    const host = document.createElement("div");
    const view = new MascotView(host, createPack(MOTION_PACK, BASE));
    const onDone = vi.fn();

    view.playChain(["cinematic"], { direction: "reverse", onDone });
    expect(img(host).src).toContain("cine/3.png");
    vi.advanceTimersByTime(100);
    expect(img(host).src).toContain("cine/2.png");
    vi.advanceTimersByTime(200);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe("MascotView explicit event frames", () => {
  test("at_frame takes precedence over progress and fires only once", () => {
    const host = document.createElement("div");
    const view = new MascotView(
      host,
      createPack(
        {
          pack_id: "remote-event",
          states: {
            remote: {
              type: "png_sequence",
              frame_files: ["r/1.png", "r/2.png", "r/3.png"],
              fps: 10,
              loop: false,
              events: [{ name: "system_scan_signal", at: 0, at_frame: 3 }],
            },
          },
        },
        BASE,
      ),
    );
    const onEvent = vi.fn();

    view.showState("remote", { onEvent });
    vi.advanceTimersByTime(199);
    expect(onEvent).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith("system_scan_signal");
    vi.advanceTimersByTime(300);
    expect(onEvent).toHaveBeenCalledTimes(1);
  });
});
