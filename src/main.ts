// 컨트롤러: 상태 머신 ↔ 백엔드 ↔ 마스코트 뷰 ↔ 패널을 배선한다.
// 기능 판단은 stateMachine, 자산 해석은 CharacterPack이 담당한다.
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./styles.css";
import {
  transition,
  mapAppStateToMascotState,
  type AppState,
  type AppEvent,
} from "./app/stateMachine";
import type { CleanupResult, CleanupSelection } from "./app/types";
import { createPack, loadPack, preloadPack } from "./mascot/packLoader";
import type { CharacterPack } from "./mascot/packTypes";
import { MascotView } from "./mascot/MascotView";
import type { BackendApi } from "./backend/api";
import { MockBackend } from "./backend/mockBackend";
import {
  TauriBackend,
  isTauri,
  setCharacterPressActive,
  setPanelOpen,
} from "./backend/tauriBackend";
import { Panel, type ScanBundle } from "./ui/panel";

const DRAG_THRESHOLD = 12;

// ── 부트스트랩 ────────────────────────────────────────────────
const characterEl = document.getElementById("character")!;
const mascotHost = document.getElementById("mascot-host")!;
const panelRoot = document.getElementById("panel")!;
const sleepBtn = document.getElementById("sleep-btn") as HTMLButtonElement;
const quitBtn = document.getElementById("quit-btn") as HTMLButtonElement;

const backend: BackendApi = isTauri() ? new TauriBackend() : new MockBackend();

async function resolvePack(): Promise<CharacterPack> {
  const packId =
    new URLSearchParams(location.search).get("pack") ?? "placeholder-svg";
  try {
    return await loadPack(`/packs/${packId}/manifest.json`);
  } catch (error) {
    console.warn("character pack load failed; using placeholder", error);
    return createPack({ pack_id: "builtin-placeholder", states: {} }, location.href);
  }
}

let mascot: MascotView | null = null;
let activePack: CharacterPack | null = null;

/** 팩이 기상 상태를 loop로 정의해도 흐름이 멈추지 않게 하는 안전장치 */
const WAKE_WATCHDOG_MS = 8000;
/** 기상 체인에서 standing_awake 브리지에 머무는 시간 */
const WAKE_BRIDGE_DWELL_MS = 1600;
/** 기상 연출: 전환 → 기상 → 눈비비기→손들기 전환 프레임 → 일어선 브리지 */
const WAKE_CHAIN: readonly string[] = [
  "01_to_02_wake_transition",
  "02_wake_up",
  "02_wake_to_02_02_transition",
  "02_02_standing_awake",
];
/** 패널 열림 연출 상태들. 던지기 시퀀스의 work_panel_open 이벤트(확대 65%
    진행 시점)에서 실제 패널을 연다. */
const PANEL_JUMP_STATE = "03_panel_open_jump_turn_left_spatial_clean";
const PANEL_PULL_STATE = "03_to_04_pull_window_from_subspace";
const PANEL_THROW_STATE = "04_to_05_throw_window_expand";

/** 팩 자산 구성에 맞는 연속성 있는 체인을 고른다.
    점프 턴(뒷모습)과 던지기(정면)는 pull(꺼내기)이 있어야 이어지므로,
    pull이 없으면 점프를 건너뛰고 정면 대기 → 던지기만 재생한다. */
function buildPanelOpenChain(): string[] {
  const has = (id: string): boolean =>
    activePack?.stateIds().includes(id) ?? false;
  if (has(PANEL_PULL_STATE)) {
    return [PANEL_JUMP_STATE, PANEL_PULL_STATE, PANEL_THROW_STATE].filter(has);
  }
  if (has(PANEL_THROW_STATE)) return [PANEL_THROW_STATE];
  if (has(PANEL_JUMP_STATE)) return [PANEL_JUMP_STATE];
  return [];
}
const PANEL_OPEN_EVENT = "work_panel_open";
const PANEL_WAIT_STATE = "04_awaiting_selection";
const READY_WINK_STATE = "03_ready_wink";
const SLEEP_REVERSE_CHAIN: readonly string[] = [
  "02_02_standing_awake",
  "02_wake_to_02_02_transition",
  "02_wake_up",
  "01_to_02_wake_transition",
  "01_sleep",
];
const SYSTEM_SCAN_REMOTE_STATE = "05_system_scan_remote_from_subspace";
const SYSTEM_SCAN_REMOTE_REPEAT_STATE = "05_system_scan_remote_press_repeat";
const SYSTEM_SCAN_REMOTE_HELD_STATE = "05_system_scan_remote_held";
const SYSTEM_SCAN_SIGNAL_EVENT = "system_scan_signal";
/** 던지기 후 캐릭터가 패널 쪽을 계속 바라보는 정지 포즈 (팩에 있으면 사용) */
const PANEL_WATCH_STATE = "05_panel_watch_hold";

// ── 상태 컨트롤러 ─────────────────────────────────────────────
let state: AppState = "sleep";
let lastScan: ScanBundle | null = null;
let lastSelection: CleanupSelection | null = null;
let lastResult: CleanupResult | null = null;
let lastError = "";
let lastErrorSource: "scan" | "exec" = "exec";
// 취소 후 재시작 경합에서 이전 실행의 결과가 새 실행을 덮어쓰지 않게 하는 세대 카운터
let scanEpoch = 0;
let cleanupEpoch = 0;
/** 리모컨 스캔 뒤에는 정면 04 포즈로 되튀지 않도록 패널 대기 포즈를 유지한다. */
let keepRemoteScanContinuity = false;
/** 앱을 연 뒤 처음 한 번만 아공간 포털을 열고, 이후에는 리모컨 누름만 반복한다. */
let hasShownRemotePortal = false;
/** 리모컨 누름이 끝나기 전에 같은 패널 동작을 중복 실행하지 않는다. */
let remoteActionPending = false;

const panel = new Panel(panelRoot, {
  onStartScan: () => dispatch({ type: "START_SCAN" }),
  onApprove: (ids, estimatedBytes) => {
    lastSelection = { kind: "temp_cleanup", itemIds: ids, estimatedBytes };
    playRemoteActionPress(() => dispatch({ type: "APPROVE" }));
  },
  onCancelScan: () => playRemoteActionPress(() => dispatch({ type: "CANCEL" })),
  onCancelCleanup: () => {
    playRemoteActionPress(() => {
      void backend.cancelCleanup();
      dispatch({ type: "CANCEL" });
    });
  },
  onRetry: () => {
    if (lastErrorSource === "scan") {
      dispatch({ type: "DISMISS" });
      dispatch({ type: "START_SCAN" });
    } else {
      dispatch({ type: "RETRY" });
    }
  },
  onDismiss: () => dispatch({ type: "DISMISS" }),
});

function dispatch(event: AppEvent): void {
  if (!mascot) return; // 부트스트랩 전 입력은 무시한다
  const next = transition(state, event);
  if (next === state) return;
  state = next;
  enterState();
}

function showMascotForState(): void {
  const stateId = mapAppStateToMascotState(state, lastSelection?.kind);
  showMascot(
    stateId,
    state === "sleep" ? { crossfade: false, startPaused: true } : undefined,
  );
}

/** 현재 재생 중인 마스코트 상태를 DOM에도 남겨 포즈별 연출을 동기화한다. */
function showMascot(
  stateId: string,
  options?: Parameters<MascotView["showState"]>[1],
): void {
  characterEl.dataset.mascotState = stateId;
  mascot?.showState(stateId, options);
}

/**
 * 리모컨을 내려놓은 뒤 패널 내용을 읽는 측면 포즈로만 전환한다.
 * 이 흐름에서는 기존 04 정면 포즈가 리모컨의 마지막 프레임과 크게 달라
 * 장면이 순간 이동한 것처럼 보이므로, 팩에 포함된 전용 대기 포즈를 쓴다.
 */
function showRemoteScanHold(): void {
  const has = (stateId: string): boolean =>
    activePack?.stateIds().includes(stateId) ?? false;
  const holdState = has(SYSTEM_SCAN_REMOTE_HELD_STATE)
    ? SYSTEM_SCAN_REMOTE_HELD_STATE
    : has(PANEL_WATCH_STATE)
      ? PANEL_WATCH_STATE
      : PANEL_WAIT_STATE;
  if (characterEl.dataset.mascotState !== holdState)
    showMascot(holdState, { crossfadeMs: 420 });
}

/**
 * 리모컨을 이미 꺼낸 흐름에서는 승인·취소도 같은 누름 모션의 송신 프레임에서
 * 실행한다. 리모컨 팩이 없는 경우에는 기존처럼 즉시 실행한다.
 */
function playRemoteActionPress(action: () => void): void {
  const canAnimate =
    keepRemoteScanContinuity &&
    !!mascot &&
    (activePack?.stateIds().includes(SYSTEM_SCAN_REMOTE_REPEAT_STATE) ?? false);
  if (!canAnimate) {
    action();
    return;
  }
  if (remoteActionPending) return;
  remoteActionPending = true;
  let actionFired = false;
  const fireAction = (): void => {
    if (actionFired) return;
    actionFired = true;
    remoteActionPending = false;
    action();
  };

  showMascot(SYSTEM_SCAN_REMOTE_REPEAT_STATE, {
    onEvent: (name) => {
      if (name === SYSTEM_SCAN_SIGNAL_EVENT) fireAction();
    },
    // 외부 팩의 이벤트가 누락돼도 승인·취소가 멈추지 않게 한다.
    onComplete: fireAction,
  });
}

/** ready 상태에서 캐릭터 클릭 시: 연출 체인을 재생하고, 던지기 시퀀스의
    work_panel_open 이벤트 시점에 실제 패널을 연다 (창 확대와 패널 등장이 겹침).
    체인이 끝나면 확대 창 프레임은 잔상 페이드아웃으로 사라지며 선택 대기로 전환.
    패널 열기가 실패하면 마지막 프레임에서 안전하게 정지한다. */
function playPanelOpenMotion(): void {
  const chain = buildPanelOpenChain();
  let panelOpened = false;
  const openNow = (): void => {
    if (panelOpened) return;
    try {
      panel.showIdle();
      openPanel();
      panelOpened = true;
    } catch (error) {
      console.warn("panel open failed; mascot holds last frame", error);
    }
  };

  if (chain.length === 0 || !mascot) {
    // 연출 자산이 없는 팩: 즉시 패널을 열고 크로스페이드 fallback
    openNow();
    showMascot(PANEL_WAIT_STATE);
    return;
  }

  const step = (index: number): void => {
    if (index >= chain.length) {
      if (!panelOpened) openNow(); // 이벤트가 없는 자산 구성 fallback
      if (panelOpened) {
        // 확대된 창이 450ms 동안 전체적으로 페이드아웃하는 동시에,
        // 패널 쪽을 돌아보고 있는 캐릭터가 그 아래에서 페이드인되어 정지 유지된다
        const rest =
          activePack?.stateIds().includes(PANEL_WATCH_STATE) ?? false
            ? PANEL_WATCH_STATE
            : PANEL_WAIT_STATE;
        showMascot(rest, { crossfadeMs: 450 });
      }
      // openNow 실패 시: 확대 창 마지막 프레임에서 안전 정지
      return;
    }
    showMascot(chain[index], {
      // 첫 진입(대기 포즈→점프 준비)은 설계 연속이라 잔상 없음, 이후 이음새는 완충
      crossfade: index > 0,
      onEvent: (name) => {
        if (name === PANEL_OPEN_EVENT) openNow();
      },
      onComplete: () => step(index + 1),
    });
  };
  step(0);
}

function playWakeSequence(): void {
  const watchdog = window.setTimeout(
    () => dispatch({ type: "WAKE_DONE" }),
    WAKE_WATCHDOG_MS,
  );
  mascot?.playChain(WAKE_CHAIN, {
    loopDwellMs: WAKE_BRIDGE_DWELL_MS,
    onDone: () => {
      window.clearTimeout(watchdog);
      dispatch({ type: "WAKE_DONE" });
    },
  });
}

/** ready에서 잠자기로 돌아갈 때 기존 기상 자산을 역순으로 이어 붙인다. */
function playSleepReverse(): void {
  if (!mascot) {
    dispatch({ type: "SLEEP" });
    return;
  }
  const chain = SLEEP_REVERSE_CHAIN.filter(
    (stateId) => activePack?.stateIds().includes(stateId) ?? false,
  );
  if (chain.length === 0) {
    dispatch({ type: "SLEEP" });
    return;
  }

  panel.hide();
  notifyPanelOpen(false);
  mascot.playChain(chain, {
    direction: "reverse",
    loopDwellMs: 500,
    onDone: () => dispatch({ type: "SLEEP" }),
  });
}

/** 클릭 피드백용 wink를 한 번만 재생한다. 팩에 전용 상태가 없으면 idle로 유지한다. */
function playReadyWink(onDone?: () => void): void {
  const hasWink = activePack?.stateIds().includes(READY_WINK_STATE) ?? false;
  if (!hasWink || !mascot) {
    onDone?.();
    return;
  }
  showMascot(READY_WINK_STATE, {
    crossfade: false,
    onComplete: () => {
      if (state === "ready") showMascotForState();
      onDone?.();
    },
  });
}

/**
 * Start the backend scan at the transmission event, while holding a fast result
 * until the non-interruptible remote motion has reached its final frame.
 */
function playSystemScanRemoteMotion(): void {
  const has = (stateId: string): boolean =>
    activePack?.stateIds().includes(stateId) ?? false;
  const replayPressOnly = hasShownRemotePortal && has(SYSTEM_SCAN_REMOTE_REPEAT_STATE);
  const motionState = replayPressOnly
    ? SYSTEM_SCAN_REMOTE_REPEAT_STATE
    : SYSTEM_SCAN_REMOTE_STATE;
  const hasRemoteMotion = has(motionState);
  if (!mascot || !hasRemoteMotion) {
    keepRemoteScanContinuity = false;
    showMascotForState();
    panel.showScanning();
    openPanel();
    void runScan();
    return;
  }

  keepRemoteScanContinuity = true;
  if (!replayPressOnly) hasShownRemotePortal = true;
  let scanStarted = false;
  let releaseMotion!: () => void;
  const motionFinished = new Promise<void>((resolve) => {
    releaseMotion = resolve;
  });
  const startScanAtSignal = (): void => {
    if (scanStarted) return;
    scanStarted = true;
    panel.showScanning();
    openPanel();
    void runScan(motionFinished);
  };

  showMascot(motionState, {
    onEvent: (name) => {
      if (name === SYSTEM_SCAN_SIGNAL_EVENT) startScanAtSignal();
    },
    onComplete: () => {
      releaseMotion();
      if (state !== "scanning") return;
      // 프레임 10의 포털 폐쇄가 충분히 보인 뒤, 같은 측면의 패널 대기 포즈로 잇는다.
      showRemoteScanHold();
      // A malformed third-party pack must not leave the scan screen stuck.
      startScanAtSignal();
    },
  });
}

// 창 크기는 항상 고정이다(리사이즈 중 WebView 리페인트 지연으로 캐릭터가
// 순간이동해 보이는 문제를 원천 제거). 대신 패널 열림 상태를 백엔드에 알려
// 캐릭터 영역 밖 클릭을 데스크톱으로 통과시킨다.
function notifyPanelOpen(open: boolean): void {
  if (!isTauri()) return;
  setPanelOpen(open).catch((error) =>
    console.warn("panel state notify failed", error),
  );
}

function notifyCharacterPressActive(active: boolean): void {
  if (!isTauri()) return;
  setCharacterPressActive(active).catch((error) =>
    console.warn("character press state notify failed", error),
  );
}

let panelTransitioning = false;

function openPanel(): void {
  if (panelTransitioning || panel.isOpen()) return;
  panel.show();
  notifyPanelOpen(true);
}

async function closePanel(): Promise<void> {
  if (panelTransitioning || !panel.isOpen()) return;
  panelTransitioning = true;
  await panel.hideAnimated();
  notifyPanelOpen(false);
  panelTransitioning = false;
}

function enterState(): void {
  characterEl.dataset.state = state;

  switch (state) {
    case "sleep":
      keepRemoteScanContinuity = false;
      panel.hide();
      notifyPanelOpen(false);
      showMascotForState();
      break;
    case "waking":
      playWakeSequence();
      break;
    case "ready":
      keepRemoteScanContinuity = false;
      showMascotForState();
      if (panel.isOpen()) panel.showIdle();
      break;
    case "scanning":
      playSystemScanRemoteMotion();
      break;
    case "preview":
      if (keepRemoteScanContinuity) showRemoteScanHold();
      else showMascotForState();
      if (lastScan) panel.showPreview(lastScan);
      break;
    case "executing":
      // 리모컨 스캔에서 이어진 모의 정리도 같은 리모컨 포즈를 유지한다.
      if (keepRemoteScanContinuity) showRemoteScanHold();
      else showMascotForState();
      panel.showProgress({ percent: 0, message: "준비 중" });
      void runCleanup();
      break;
    case "success":
    case "warning":
      if (keepRemoteScanContinuity) showRemoteScanHold();
      else showMascotForState();
      if (lastResult) panel.showResult(lastResult);
      break;
    case "error":
      if (keepRemoteScanContinuity) showRemoteScanHold();
      else showMascotForState();
      panel.showError(lastError || "알 수 없는 오류가 발생했습니다.");
      break;
  }
}

// ── 백엔드 오케스트레이션 ─────────────────────────────────────
async function runScan(completeAfter?: Promise<void>): Promise<void> {
  const epoch = ++scanEpoch;
  const errors: string[] = [];
  const soft = async <T>(label: string, task: Promise<T>): Promise<T | null> => {
    try {
      return await task;
    } catch (error) {
      errors.push(`${label}: ${String(error)}`);
      return null;
    }
  };

  const [temp, startup, services, tasks, processes] = await Promise.all([
    soft("임시 파일", backend.scanTempFiles()),
    soft("시작프로그램", backend.listStartupItems()),
    soft("서비스", backend.listServices()),
    soft("예약 작업", backend.listScheduledTasks()),
    soft("프로세스", backend.listProcesses()),
  ]);

  // 취소되었거나 이미 새 스캔이 시작된 경우: 이 결과는 폐기한다
  await completeAfter;

  if (epoch !== scanEpoch || state !== "scanning") return;

  if (!temp) {
    lastError = errors.join("\n");
    lastErrorSource = "scan";
    dispatch({ type: "SCAN_FAILED" });
    return;
  }

  lastScan = {
    temp,
    startup: startup ?? [],
    services: services ?? [],
    tasks: tasks ?? [],
    processes: processes ?? [],
    errors,
  };
  dispatch({ type: "SCAN_DONE" });
}

async function runCleanup(): Promise<void> {
  const epoch = ++cleanupEpoch;
  const selection = lastSelection;
  if (!selection) {
    lastError = "선택된 항목이 없습니다.";
    lastErrorSource = "exec";
    dispatch({ type: "EXEC_FAILED" });
    return;
  }
  try {
    const result = await backend.startMockCleanup(selection, (progress) => {
      if (epoch === cleanupEpoch && state === "executing")
        panel.showProgress(progress);
    });
    if (epoch !== cleanupEpoch) return; // 재시도 등으로 새 실행이 시작됨
    lastResult = result;
    if (result.outcome === "error") {
      lastError = result.message;
      lastErrorSource = "exec";
    }
    if (state === "executing" || state === "warning") {
      // warning은 취소-완료 경합: 백엔드의 실제 결과로 재동기화한다
      const before = state;
      dispatch({ type: "EXEC_DONE", outcome: result.outcome });
      if (state === before) panel.showResult(result); // 무전이여도 결과는 갱신
    }
  } catch (error) {
    if (epoch !== cleanupEpoch) return;
    lastError = String(error);
    lastErrorSource = "exec";
    dispatch({ type: "EXEC_FAILED" });
  }
}

// ── 입력 처리 ─────────────────────────────────────────────────
characterEl.addEventListener("dblclick", () => {
  if (state === "sleep") dispatch({ type: "DOUBLE_CLICK" });
});

characterEl.addEventListener("click", () => {
  if (state !== "ready") return;
  if (panel.isOpen()) {
    void closePanel();
    playReadyWink();
  } else {
    // 클릭 피드백을 먼저 보여준 뒤 패널 열기 연출을 시작한다.
    playReadyWink(() => {
      if (state === "ready" && !panel.isOpen()) playPanelOpenMotion();
    });
  }
});

// 드래그 이동 (임계값 초과 시에만 창 드래그 시작)
let pressed = false;
let pressX = 0;
let pressY = 0;

characterEl.addEventListener("mousedown", (event: MouseEvent) => {
  if (event.button !== 0) return;
  if (state === "sleep") mascot?.resumePlayback();
  pressed = true;
  pressX = event.clientX;
  pressY = event.clientY;
  notifyCharacterPressActive(true);
});

window.addEventListener("mousemove", (event: MouseEvent) => {
  if (!pressed) return;
  if (
    Math.abs(event.clientX - pressX) > DRAG_THRESHOLD ||
    Math.abs(event.clientY - pressY) > DRAG_THRESHOLD
  ) {
    pressed = false;
    if (isTauri()) void getCurrentWindow().startDragging();
  }
});

function releaseCharacterPress(): void {
  pressed = false;
  if (state === "sleep") mascot?.pausePlayback();
  notifyCharacterPressActive(false);
}

window.addEventListener("mouseup", releaseCharacterPress);
window.addEventListener("blur", releaseCharacterPress);

// 우클릭 → 종료/잠자기 버튼
window.addEventListener("contextmenu", (event: MouseEvent) => {
  event.preventDefault();
  quitBtn.hidden = false;
  sleepBtn.hidden = state !== "ready";
});

sleepBtn.addEventListener("click", () => {
  sleepBtn.hidden = true;
  quitBtn.hidden = true;
  playSleepReverse();
});

quitBtn.addEventListener("click", () => {
  if (isTauri()) void getCurrentWindow().close();
});

window.addEventListener("mousedown", (event: MouseEvent) => {
  if (!quitBtn.hidden && event.target !== quitBtn) quitBtn.hidden = true;
  if (!sleepBtn.hidden && event.target !== sleepBtn) sleepBtn.hidden = true;
});

// ── 시작 ──────────────────────────────────────────────────────
void (async () => {
  const pack = await resolvePack();
  activePack = pack;
  preloadPack(pack); // 첫 재생 끊김 방지: 모든 프레임을 미리 캐시에 올린다
  // 아트에 zz가 그려진 팩은 내장 Zzz 오버레이를 끈다 (이중 표시 방지)
  document.getElementById("zzz")!.hidden = !pack.zzzOverlay;
  mascot = new MascotView(mascotHost, pack);
  enterState();
})();
