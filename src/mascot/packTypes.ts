// CharacterPack 매니페스트 계약 타입.
// 팩은 state_id → 표현물 매핑을 소유하고, 기능 로직은 이 계약만 사용한다.

export type RenderType = "png_sequence" | "svg" | "static_image";

/** URL이 해석된, 렌더러가 바로 사용할 수 있는 표현물 */
/** 시퀀스 진행 중 특정 진행률에서 발화하는 이벤트 (예: work_panel_open) */
export interface SequenceEvent {
  name: string;
  /** 0~1 진행률. floor(at * (frame_count - 1)) 프레임 도달 시 발화 */
  at: number;
  /** Explicit 1-based frame. When present, this takes priority over progress. */
  atFrame?: number;
}

export type ResolvedVisual =
  | {
      type: "png_sequence";
      frames: string[];
      fps: number;
      loop: boolean;
      holdMs: number;
      /** false면 재생 완료 전 다른 상태로 교체하지 않는다 (연출 보호) */
      interruptible: boolean;
      events: SequenceEvent[];
      /** 프레임별 표시 시간(ms). 없으면 1000/fps 균등 간격. 완급 연출용 */
      frameMs?: number[];
    }
  | {
      type: "svg" | "static_image";
      src: string;
    };

export interface CharacterPack {
  packId: string;
  version: string;
  canvas: { width: number; height: number };
  /** 수면 시 내장 Zzz DOM 효과 사용 여부. 아트에 zz가 그려진 팩은 false */
  zzzOverlay: boolean;
  /** 매니페스트에 선언된 state_id 목록 */
  stateIds(): string[];
  /** state_id의 표현물을 찾는다. 누락 시 fallback → 내장 placeholder로 강등 */
  resolveState(stateId: string): ResolvedVisual;
}
