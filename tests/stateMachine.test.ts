import { describe, expect, test } from "vitest";
import {
  transition,
  mapAppStateToMascotState,
  WAKE_SEQUENCE,
  type AppState,
  type AppEvent,
} from "../src/app/stateMachine";

function seq(start: AppState, events: AppEvent[]): AppState {
  return events.reduce((s, e) => transition(s, e), start);
}

describe("transition — 제품 흐름", () => {
  test("sleep → wake → ready → scan → preview → executing → success → ready", () => {
    expect(transition("sleep", { type: "DOUBLE_CLICK" })).toBe("waking");
    expect(transition("waking", { type: "WAKE_DONE" })).toBe("ready");
    expect(transition("ready", { type: "START_SCAN" })).toBe("scanning");
    expect(transition("scanning", { type: "SCAN_DONE" })).toBe("preview");
    expect(transition("preview", { type: "APPROVE" })).toBe("executing");
    expect(
      transition("executing", { type: "EXEC_DONE", outcome: "success" }),
    ).toBe("success");
    expect(transition("success", { type: "DISMISS" })).toBe("ready");
  });

  test("실행 결과가 경고·오류이면 마스코트도 그대로 따라간다 (거짓 성공 신호 금지)", () => {
    expect(
      transition("executing", { type: "EXEC_DONE", outcome: "warning" }),
    ).toBe("warning");
    expect(
      transition("executing", { type: "EXEC_DONE", outcome: "error" }),
    ).toBe("error");
    expect(transition("executing", { type: "EXEC_FAILED" })).toBe("error");
  });

  test("취소: 스캔 중 → ready, 미리보기 → ready, 실행 중 → warning(부분 완료)", () => {
    expect(transition("scanning", { type: "CANCEL" })).toBe("ready");
    expect(transition("preview", { type: "CANCEL" })).toBe("ready");
    expect(transition("executing", { type: "CANCEL" })).toBe("warning");
  });

  test("취소 직후 백엔드 결과가 도착하면 실제 결과로 재동기화한다", () => {
    // 사용자가 취소했지만 백엔드가 이미 완료한 경합: 마스코트는 백엔드 결과를 따라간다
    expect(transition("warning", { type: "EXEC_DONE", outcome: "success" })).toBe(
      "success",
    );
    expect(transition("warning", { type: "EXEC_DONE", outcome: "warning" })).toBe(
      "warning",
    );
    expect(transition("warning", { type: "EXEC_DONE", outcome: "error" })).toBe(
      "error",
    );
  });

  test("재시도와 재스캔", () => {
    expect(transition("error", { type: "RETRY" })).toBe("executing");
    expect(transition("error", { type: "DISMISS" })).toBe("ready");
    expect(transition("preview", { type: "START_SCAN" })).toBe("scanning");
  });

  test("스캔 실패 → error", () => {
    expect(transition("scanning", { type: "SCAN_FAILED" })).toBe("error");
  });

  test("ready에서 다시 잠들 수 있다", () => {
    expect(transition("ready", { type: "SLEEP" })).toBe("sleep");
  });

  test("불허 전이는 상태를 유지한다", () => {
    expect(transition("sleep", { type: "APPROVE" })).toBe("sleep");
    expect(transition("sleep", { type: "START_SCAN" })).toBe("sleep");
    expect(transition("executing", { type: "DOUBLE_CLICK" })).toBe("executing");
    expect(transition("scanning", { type: "APPROVE" })).toBe("scanning");
    expect(transition("ready", { type: "WAKE_DONE" })).toBe("ready");
  });

  test("전체 흐름 시나리오는 결정론적이다", () => {
    const end = seq("sleep", [
      { type: "DOUBLE_CLICK" },
      { type: "WAKE_DONE" },
      { type: "START_SCAN" },
      { type: "SCAN_DONE" },
      { type: "APPROVE" },
      { type: "CANCEL" },
      { type: "DISMISS" },
      { type: "START_SCAN" },
      { type: "SCAN_FAILED" },
      { type: "RETRY" },
      { type: "EXEC_DONE", outcome: "success" },
    ]);
    expect(end).toBe("success");
  });
});

describe("mapAppStateToMascotState — 상태 계약", () => {
  test("각 앱 상태는 매니페스트 state_id로 매핑된다", () => {
    expect(mapAppStateToMascotState("sleep")).toBe("01_sleep");
    expect(mapAppStateToMascotState("waking")).toBe("01_to_02_wake_transition");
    expect(mapAppStateToMascotState("ready")).toBe("03_ready_idle");
    expect(mapAppStateToMascotState("scanning")).toBe("05_system_scan");
    expect(mapAppStateToMascotState("preview")).toBe("04_awaiting_selection");
    expect(mapAppStateToMascotState("success")).toBe("12_success");
    expect(mapAppStateToMascotState("warning")).toBe("10_warning");
    expect(mapAppStateToMascotState("error")).toBe("11_error_blocked");
  });

  test("실행 중 마스코트는 작업 종류를 반영한다", () => {
    expect(mapAppStateToMascotState("executing", "temp_cleanup")).toBe(
      "06_temp_file_cleanup",
    );
    expect(mapAppStateToMascotState("executing", "generic")).toBe(
      "09_optimization_progress",
    );
    expect(mapAppStateToMascotState("executing")).toBe(
      "09_optimization_progress",
    );
  });

  test("기상 시퀀스는 전환 → 기상 순서", () => {
    expect(WAKE_SEQUENCE).toEqual(["01_to_02_wake_transition", "02_wake_up"]);
  });
});
