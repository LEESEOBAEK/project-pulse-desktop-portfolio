// 앱 상태 머신: 순수 리듀서. DOM·Tauri·캐릭터 팩에 의존하지 않는다.
import type { CleanupOutcome, TaskKind } from "./types";

export type AppState =
  | "sleep"
  | "waking"
  | "ready"
  | "scanning"
  | "preview"
  | "executing"
  | "success"
  | "warning"
  | "error";

export type AppEvent =
  | { type: "DOUBLE_CLICK" }
  | { type: "WAKE_DONE" }
  | { type: "START_SCAN" }
  | { type: "SCAN_DONE" }
  | { type: "SCAN_FAILED" }
  | { type: "APPROVE" }
  | { type: "CANCEL" }
  | { type: "EXEC_DONE"; outcome: CleanupOutcome }
  | { type: "EXEC_FAILED" }
  | { type: "RETRY" }
  | { type: "DISMISS" }
  | { type: "SLEEP" };

type TransitionTable = {
  [S in AppState]?: Partial<Record<AppEvent["type"], AppState>>;
};

const TABLE: TransitionTable = {
  sleep: { DOUBLE_CLICK: "waking" },
  waking: { WAKE_DONE: "ready" },
  ready: { START_SCAN: "scanning", SLEEP: "sleep" },
  scanning: { SCAN_DONE: "preview", SCAN_FAILED: "error", CANCEL: "ready" },
  preview: { APPROVE: "executing", CANCEL: "ready", START_SCAN: "scanning" },
  executing: { EXEC_FAILED: "error", CANCEL: "warning" },
  success: { DISMISS: "ready" },
  warning: { DISMISS: "ready" },
  error: { RETRY: "executing", DISMISS: "ready" },
};

export function transition(state: AppState, event: AppEvent): AppState {
  // warning에서의 EXEC_DONE: 취소 직후 백엔드가 실제 결과를 돌려준 경합.
  // 마스코트·패널이 백엔드 결과와 다른 신호를 내지 않도록 재동기화한다.
  if (
    (state === "executing" || state === "warning") &&
    event.type === "EXEC_DONE"
  ) {
    return event.outcome;
  }
  return TABLE[state]?.[event.type] ?? state;
}

// ── 마스코트 상태 매핑 ─────────────────────────────────────────
// state_id 문자열은 캐릭터 팩 매니페스트 계약과 동일하다.
// 이 매핑은 "어떤 상태를 보여줄지"만 결정하며 자산 경로는 알지 못한다.

const MASCOT_MAP: Record<Exclude<AppState, "executing">, string> = {
  sleep: "01_sleep",
  waking: "01_to_02_wake_transition",
  ready: "03_ready_idle",
  scanning: "05_system_scan",
  preview: "04_awaiting_selection",
  success: "12_success",
  warning: "10_warning",
  error: "11_error_blocked",
};

export function mapAppStateToMascotState(
  state: AppState,
  taskKind?: TaskKind,
): string {
  if (state === "executing") {
    return taskKind === "temp_cleanup"
      ? "06_temp_file_cleanup"
      : "09_optimization_progress";
  }
  return MASCOT_MAP[state];
}

/** 기상 연출: waking 진입 시 순서대로 재생 후 WAKE_DONE을 디스패치한다. */
export const WAKE_SEQUENCE: readonly string[] = [
  "01_to_02_wake_transition",
  "02_wake_up",
];
