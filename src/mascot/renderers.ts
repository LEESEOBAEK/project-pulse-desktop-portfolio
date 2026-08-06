// 렌더러 어댑터: 표현물 타입별 렌더링을 담당한다.
// 상태 머신·백엔드는 이 계층을 알지 못한다.
import type { RenderType, ResolvedVisual } from "./packTypes";

export interface RenderOptions {
  onComplete?: () => void;
  /** false면 이전 프레임 잔상(크로스페이드)을 만들지 않는다. 기본 true.
      설계된 연속 프레임(전환 상태)으로 이어질 때 사용한다. */
  crossfade?: boolean;
  /** 이 전환의 잔상 디졸브 길이(ms). 미지정 시 기본값(160ms) */
  crossfadeMs?: number;
  /** 시퀀스의 events 진행률 지점을 지날 때 이벤트 이름과 함께 호출된다 */
  onEvent?: (name: string) => void;
  /** 첫 프레임만 표시하고 재생 타이머를 시작하지 않는다. */
  startPaused?: boolean;
  /** 시퀀스를 역순으로 재생한다. */
  direction?: "forward" | "reverse";
}

export interface MascotRenderer {
  mount(host: HTMLElement): void;
  render(visual: ResolvedVisual, options?: RenderOptions): void;
  stop(): void;
  pause(): void;
  resume(): void;
  dispose(): void;
}

/** 단일 이미지(svg·static_image)의 완료 통지 지연: 시퀀스의 1회 재생에 상응 */
const SINGLE_IMAGE_COMPLETE_MS = 400;

abstract class ImageElementRenderer implements MascotRenderer {
  protected image: HTMLImageElement | null = null;
  protected timer: ReturnType<typeof setInterval> | undefined;
  protected oneShot: ReturnType<typeof setTimeout> | undefined;

  mount(host: HTMLElement): void {
    this.image = document.createElement("img");
    this.image.draggable = false;
    this.image.alt = "";
    host.appendChild(this.image);
  }

  abstract render(visual: ResolvedVisual, options?: RenderOptions): void;

  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.oneShot !== undefined) {
      clearTimeout(this.oneShot);
      this.oneShot = undefined;
    }
  }

  pause(): void {
    this.stop();
  }

  resume(): void {
    // 단일 이미지에는 재개할 프레임 타이머가 없다.
  }

  dispose(): void {
    this.stop();
    this.image?.remove();
    this.image = null;
  }
}

export class PngSequenceRenderer extends ImageElementRenderer {
  private visual: Extract<ResolvedVisual, { type: "png_sequence" }> | null = null;
  private options: RenderOptions | undefined;
  private index = 0;
  private direction: 1 | -1 = 1;
  private paused = false;
  private pendingEvents: { name: string; frame: number; fired: boolean }[] = [];

  render(visual: ResolvedVisual, options?: RenderOptions): void {
    if (visual.type !== "png_sequence" || !this.image) return;
    this.stop();

    this.visual = visual;
    this.options = options;
    this.direction = options?.direction === "reverse" ? -1 : 1;
    this.index = this.direction === 1 ? 0 : visual.frames.length - 1;
    this.paused = options?.startPaused === true;

    const { frames, events } = visual;
    // 프레임별 표시 시간: frameMs가 있으면 완급 연출, 없으면 fps 균등 간격
    const uniform = 1000 / visual.fps;
    const durationOf = (frameIndex: number): number =>
      visual.frameMs?.[frameIndex] ?? uniform;

    this.image.src = frames[this.index];

    // 이벤트 발화 프레임(0-기준) 사전 계산 — 프레임 도달 시 한 번만 발화
    this.pendingEvents = (events ?? []).map((event) => ({
      name: event.name,
      frame:
        event.atFrame === undefined
          ? Math.floor(event.at * (frames.length - 1))
          : event.atFrame - 1,
      fired: false,
    }));
    const fireEvents = (frameIndex: number) => {
      if (this.direction === -1) return;
      for (const event of this.pendingEvents) {
        if (!event.fired && frameIndex >= event.frame) {
          event.fired = true;
          options?.onEvent?.(event.name);
        }
      }
    };
    if (this.direction === 1) fireEvents(this.index);

    const scheduleNext = (): void => {
      if (this.paused || !this.visual) return;
      this.oneShot = setTimeout(() => {
        this.oneShot = undefined;
        if (!this.visual || this.paused) return;
        const nextIndex = this.index + this.direction;
        if (nextIndex >= 0 && nextIndex < frames.length) {
          this.index = nextIndex;
          this.image!.src = frames[this.index];
          fireEvents(this.index);
          scheduleNext();
          return;
        }
        if (visual.loop) {
          this.index = this.direction === 1 ? 0 : frames.length - 1;
          this.image!.src = frames[this.index];
          scheduleNext();
          return;
        }
        // 마지막 프레임 유지(hold) 후 완료 통지
        if (visual.holdMs > 0) {
          this.oneShot = setTimeout(() => {
            this.oneShot = undefined;
            options?.onComplete?.();
          }, visual.holdMs);
        } else {
          options?.onComplete?.();
        }
      }, durationOf(this.index));
    };
    if (!this.paused) scheduleNext();
  }

  pause(): void {
    this.paused = true;
    super.pause();
  }

  resume(): void {
    if (!this.visual || !this.paused) return;
    this.paused = false;
    const frameMs = this.visual.frameMs?.[this.index] ?? 1000 / this.visual.fps;
    this.oneShot = setTimeout(() => {
      this.oneShot = undefined;
      if (this.paused || !this.visual || !this.image) return;
      const nextIndex = this.index + this.direction;
      if (nextIndex < 0 || nextIndex >= this.visual.frames.length) {
        if (this.visual.loop) {
          this.index = this.direction === 1 ? 0 : this.visual.frames.length - 1;
          this.image.src = this.visual.frames[this.index];
          this.resume();
        } else {
          this.options?.onComplete?.();
        }
        return;
      }
      this.index = nextIndex;
      this.image.src = this.visual.frames[this.index];
      this.resume();
    }, frameMs);
  }
}

/** 단일 이미지 렌더러: svg와 static_image 공용 */
export class SvgRenderer extends ImageElementRenderer {
  render(visual: ResolvedVisual, options?: RenderOptions): void {
    if (visual.type === "png_sequence" || !this.image) return;
    this.stop();
    this.image.src = visual.src;
    if (options?.onComplete) {
      const onComplete = options.onComplete;
      this.oneShot = setTimeout(() => {
        this.oneShot = undefined;
        onComplete();
      }, SINGLE_IMAGE_COMPLETE_MS);
    }
  }
}

export function createRenderer(type: RenderType): MascotRenderer {
  return type === "png_sequence"
    ? new PngSequenceRenderer()
    : new SvgRenderer();
}
