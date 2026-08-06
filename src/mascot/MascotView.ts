// MascotView: 팩에서 상태 표현물을 조회하고 알맞은 렌더러로 표시한다.
// interruptible=false 시퀀스는 재생 완료까지 보호하고, 그동안의 요청은 마지막 것만 대기시킨다.
import type { CharacterPack, RenderType } from "./packTypes";
import { createRenderer, type MascotRenderer, type RenderOptions } from "./renderers";

/** playChain에서 loop 상태를 브리지로 지나갈 때의 기본 체류 시간 */
const DEFAULT_LOOP_DWELL_MS = 1600;
/** 상태 전환 시 이전 프레임 잔상이 사라지는 시간 — 자산 간 포즈 점프를 완충하고,
    확대 창 → 실제 패널 전환의 페이드아웃(120~180ms 사양)도 이 값으로 수행한다 */
const CROSSFADE_MS = 160;

export interface ChainOptions {
  onDone?: () => void;
  loopDwellMs?: number;
  direction?: "forward" | "reverse";
}

export class MascotView {
  private renderer: MascotRenderer | null = null;
  private rendererType: RenderType | null = null;
  /** 비중단 시퀀스 재생 중 여부 */
  private busy = false;
  /** busy 동안 도착한 마지막 showState 요청 */
  private pending: { stateId: string; options?: RenderOptions } | null = null;
  private chainTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly host: HTMLElement,
    private pack: CharacterPack,
  ) {
    this.applyCanvasRatio();
  }

  /** 팩 캔버스 비율을 host에 적용해 상태 간 크기·위치가 일관되게 한다 */
  private applyCanvasRatio(): void {
    const { width, height } = this.pack.canvas;
    this.host.style.aspectRatio = `${width} / ${height}`;
  }

  showState(stateId: string, options?: RenderOptions): void {
    if (this.busy) {
      this.pending = { stateId, options };
      return;
    }
    this.renderNow(stateId, options);
  }

  /** 현재 PNG 시퀀스를 일시정지한다. 단일 이미지에는 영향이 없다. */
  pausePlayback(): void {
    this.renderer?.pause();
  }

  /** 일시정지한 PNG 시퀀스를 현재 프레임부터 재개한다. */
  resumePlayback(): void {
    this.renderer?.resume();
  }

  /**
   * 직전에 표시되던 프레임을 잔상으로 겹쳐 짧게 페이드 아웃한다.
   * 자산 간 포즈가 이어지지 않는 이음새(예: 눈비비기 → 손들기)를 완충한다.
   */
  private beginCrossfade(durationMs: number): void {
    const current = this.host.querySelector<HTMLImageElement>(
      "img:not(.mascot-fade)",
    );
    if (!current?.src) return;
    const ghost = document.createElement("div");
    ghost.className = "mascot-fade";
    ghost.style.backgroundImage = `url(${current.src})`;
    ghost.style.animationDuration = `${durationMs}ms`;
    this.host.appendChild(ghost);
    setTimeout(() => ghost.remove(), durationMs);
  }

  private renderNow(stateId: string, options?: RenderOptions): void {
    if (options?.crossfade !== false)
      this.beginCrossfade(options?.crossfadeMs ?? CROSSFADE_MS);
    const visual = this.pack.resolveState(stateId);
    if (this.rendererType !== visual.type || !this.renderer) {
      this.renderer?.dispose();
      this.renderer = createRenderer(visual.type);
      this.renderer.mount(this.host);
      this.rendererType = visual.type;
    }

    const protectedPlayback =
      visual.type === "png_sequence" && !visual.loop && !visual.interruptible;
    this.busy = protectedPlayback;

    this.renderer.render(visual, {
      onEvent: options?.onEvent,
      startPaused: options?.startPaused,
      direction: options?.direction,
      onComplete: () => {
        this.busy = false;
        options?.onComplete?.();
        if (this.pending) {
          const next = this.pending;
          this.pending = null;
          this.renderNow(next.stateId, next.options);
        }
      },
    });
  }

  /**
   * 상태 목록을 순서대로 재생한다. 비loop 시퀀스는 완료까지, loop·단일 이미지는
   * loopDwellMs 동안 재생한 뒤 다음으로 진행하고, 마지막까지 끝나면 onDone.
   */
  playChain(stateIds: readonly string[], options?: ChainOptions): void {
    this.cancelChain();
    const dwell = options?.loopDwellMs ?? DEFAULT_LOOP_DWELL_MS;

    const step = (index: number): void => {
      if (index >= stateIds.length) {
        options?.onDone?.();
        return;
      }
      const stateId = stateIds[index];
      const visual = this.pack.resolveState(stateId);
      const runsToCompletion = visual.type === "png_sequence" && !visual.loop;
      // 체인 내부 연결은 설계된 연속 프레임이므로 잔상 완충을 쓰지 않는다
      const crossfade = index === 0;

      if (runsToCompletion) {
        this.showState(stateId, {
          crossfade,
          direction: options?.direction,
          onComplete: () => step(index + 1),
        });
      } else {
        this.showState(stateId, { crossfade, direction: options?.direction });
        this.chainTimer = setTimeout(() => {
          this.chainTimer = undefined;
          step(index + 1);
        }, dwell);
      }
    };

    step(0);
  }

  private cancelChain(): void {
    if (this.chainTimer !== undefined) {
      clearTimeout(this.chainTimer);
      this.chainTimer = undefined;
    }
  }

  setPack(pack: CharacterPack): void {
    this.pack = pack;
    this.cancelChain();
    this.busy = false;
    this.pending = null;
    this.renderer?.dispose();
    this.renderer = null;
    this.rendererType = null;
    this.applyCanvasRatio();
  }

  dispose(): void {
    this.cancelChain();
    this.busy = false;
    this.pending = null;
    this.renderer?.dispose();
    this.renderer = null;
    this.rendererType = null;
  }
}
