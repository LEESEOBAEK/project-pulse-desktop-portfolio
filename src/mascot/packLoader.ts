// 캐릭터 팩 매니페스트 로더: 검증·URL 해석·fallback 강등.
import type { CharacterPack, ResolvedVisual } from "./packTypes";

/** 팩·상태가 전혀 없을 때 쓰는 내장 정적 placeholder (외부 자산 의존 없음) */
export const BUILTIN_PLACEHOLDER =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120">' +
      '<circle cx="60" cy="60" r="48" fill="#8ea6d8"/>' +
      '<circle cx="45" cy="52" r="6" fill="#233"/>' +
      '<circle cx="75" cy="52" r="6" fill="#233"/>' +
      '<path d="M42 76 q18 14 36 0" stroke="#233" stroke-width="4" fill="none"/>' +
      "</svg>",
  );

interface RawSequence {
  type: "png_sequence";
  frame_template?: string;
  /** Ordered file list copied from an external sequence manifest. */
  frame_files?: string[];
  frame_count?: number;
  fps: number;
  loop?: boolean;
  hold_ms?: number;
  interruptible?: boolean;
  events?: { name?: unknown; at?: unknown; at_frame?: unknown }[];
  frame_ms?: unknown;
}

interface RawSingle {
  type: "svg" | "static_image";
  src: string;
}

type RawState = RawSequence | RawSingle;

function fail(packId: string, message: string): never {
  throw new Error(`character pack "${packId}": ${message}`);
}

function expandTemplate(template: string, frame: number): string {
  return template.replace(/\{frame(?::0?(\d+))?\}/, (_m, pad?: string) =>
    pad ? String(frame).padStart(Number(pad), "0") : String(frame),
  );
}

function validateState(packId: string, id: string, raw: unknown): RawState {
  const state = raw as {
    type?: unknown;
    frame_template?: unknown;
    frame_files?: unknown;
    frame_count?: unknown;
    fps?: unknown;
    loop?: unknown;
    hold_ms?: unknown;
    interruptible?: unknown;
    events?: unknown;
    frame_ms?: unknown;
    src?: unknown;
  };
  if (state.type === "png_sequence") {
    const frameFiles = Array.isArray(state.frame_files)
      ? state.frame_files.filter((file): file is string => typeof file === "string")
      : undefined;
    if (
      Array.isArray(state.frame_files) &&
      frameFiles!.length !== state.frame_files.length
    )
      fail(packId, `state "${id}" frame_files must contain only strings`);
    if (!frameFiles?.length && typeof state.frame_template !== "string")
      fail(packId, `state "${id}" requires frame_template or frame_files`);
    if (
      frameFiles?.length &&
      typeof state.frame_count === "number" &&
      state.frame_count !== frameFiles.length
    )
      fail(packId, `state "${id}" frame_count must match frame_files`);
    if (
      !frameFiles?.length &&
      (typeof state.frame_count !== "number" || state.frame_count < 1)
    )
      fail(packId, `state "${id}" requires frame_count >= 1`);
    if (typeof state.fps !== "number" || state.fps <= 0)
      fail(packId, `state "${id}" requires fps > 0`);
    return {
      type: "png_sequence",
      frame_template:
        typeof state.frame_template === "string" ? state.frame_template : undefined,
      frame_files: frameFiles,
      frame_count: frameFiles?.length ?? (state.frame_count as number),
      fps: state.fps,
      loop: typeof state.loop === "boolean" ? state.loop : undefined,
      hold_ms: typeof state.hold_ms === "number" ? state.hold_ms : undefined,
      interruptible:
        typeof state.interruptible === "boolean" ? state.interruptible : undefined,
      events: Array.isArray(state.events) ? state.events : undefined,
      frame_ms: state.frame_ms,
    };
  }
  if (state.type === "svg" || state.type === "static_image") {
    if (typeof state.src !== "string")
      fail(packId, `state "${id}" requires src`);
    return { type: state.type, src: state.src };
  }
  fail(packId, `state "${id}" has unknown type "${String(state.type)}"`);
}

function resolveVisual(raw: RawState, baseUrl: string): ResolvedVisual {
  if (raw.type === "png_sequence") {
    const frames = raw.frame_files
      ? raw.frame_files.map((file) => new URL(file, baseUrl).toString())
      : Array.from({ length: raw.frame_count! }, (_v, i) =>
          new URL(expandTemplate(raw.frame_template!, i + 1), baseUrl).toString(),
        );
    const frameMs =
      Array.isArray(raw.frame_ms) &&
      raw.frame_ms.length === frames.length &&
      raw.frame_ms.every((ms) => typeof ms === "number" && ms > 0)
        ? (raw.frame_ms as number[])
        : undefined;
    return {
      type: "png_sequence",
      frames,
      fps: raw.fps,
      loop: raw.loop ?? false,
      holdMs: raw.hold_ms ?? 0,
      interruptible: raw.interruptible ?? true,
      events: (raw.events ?? [])
        .filter(
          (event) =>
            typeof event?.name === "string" &&
            typeof event?.at === "number" &&
            event.at >= 0 &&
            event.at <= 1 &&
            (event.at_frame === undefined ||
              (typeof event.at_frame === "number" &&
                Number.isInteger(event.at_frame) &&
                event.at_frame >= 1 &&
                event.at_frame <= frames.length)),
        )
        .map((event) => {
          const resolved = { name: event.name as string, at: event.at as number };
          return typeof event.at_frame === "number"
            ? { ...resolved, atFrame: event.at_frame }
            : resolved;
        }),
      frameMs,
    };
  }
  return { type: raw.type, src: new URL(raw.src, baseUrl).toString() };
}

export function createPack(manifest: unknown, baseUrl: string): CharacterPack {
  const raw = manifest as {
    pack_id?: unknown;
    version?: unknown;
    canvas?: { width?: number; height?: number };
    fallback_state?: unknown;
    zzz_overlay?: unknown;
    states?: Record<string, unknown>;
  };

  if (typeof raw.pack_id !== "string" || raw.pack_id.length === 0)
    throw new Error('character pack manifest requires "pack_id"');
  const packId = raw.pack_id;
  if (raw.states === undefined || raw.states === null || typeof raw.states !== "object")
    fail(packId, 'manifest requires "states"');

  const states = new Map<string, ResolvedVisual>();
  for (const [id, rawState] of Object.entries(raw.states)) {
    states.set(id, resolveVisual(validateState(packId, id, rawState), baseUrl));
  }

  const fallbackState =
    typeof raw.fallback_state === "string" ? raw.fallback_state : undefined;

  return {
    packId,
    version: typeof raw.version === "string" ? raw.version : "0.0.0",
    canvas: {
      width: raw.canvas?.width ?? 400,
      height: raw.canvas?.height ?? 300,
    },
    zzzOverlay: raw.zzz_overlay !== false,
    stateIds(): string[] {
      return [...states.keys()];
    },
    resolveState(stateId: string): ResolvedVisual {
      return (
        states.get(stateId) ??
        (fallbackState ? states.get(fallbackState) : undefined) ?? {
          type: "static_image",
          src: BUILTIN_PLACEHOLDER,
        }
      );
    },
  };
}

/**
 * 팩의 모든 프레임·이미지를 브라우저 캐시에 미리 올린다.
 * 첫 재생 시 로드 지연으로 인한 끊김·깜빡임을 막는다. 프리로드한 URL 목록을 돌려준다.
 */
export function preloadPack(pack: CharacterPack): string[] {
  const urls = new Set<string>();
  for (const stateId of pack.stateIds()) {
    const visual = pack.resolveState(stateId);
    if (visual.type === "png_sequence") {
      for (const frame of visual.frames) urls.add(frame);
    } else {
      urls.add(visual.src);
    }
  }
  for (const url of urls) {
    const image = new Image();
    image.src = url;
  }
  return [...urls];
}

/** 매니페스트를 URL에서 받아 팩을 만든다. 실패 시 예외 — 호출자가 placeholder로 강등한다. */
export async function loadPack(manifestUrl: string): Promise<CharacterPack> {
  const response = await fetch(manifestUrl);
  if (!response.ok)
    throw new Error(`failed to load pack manifest: ${response.status}`);
  const manifest = await response.json();
  const base = new URL(".", new URL(manifestUrl, location.href)).toString();
  return createPack(manifest, base);
}
