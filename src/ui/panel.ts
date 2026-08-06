// 패널 UI: 스캔·미리보기·승인·진행률·결과 화면.
// 상태 머신을 소유하지 않는다 — 콜백으로 이벤트 의도만 전달한다.
import type {
  CleanupResult,
  Progress,
  ProcessInfo,
  ScheduledTask,
  ServiceInfo,
  StartupItem,
  TempFileScan,
} from "../app/types";

export interface ScanBundle {
  temp: TempFileScan;
  startup: StartupItem[];
  services: ServiceInfo[];
  tasks: ScheduledTask[];
  processes: ProcessInfo[];
  errors: string[];
}

export interface PanelCallbacks {
  onStartScan(): void;
  onApprove(selectedIds: string[], estimatedBytes: number): void;
  onCancelScan(): void;
  onCancelCleanup(): void;
  onRetry(): void;
  onDismiss(): void;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, className: string, onClick: () => void) {
  const node = el("button", className, label);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

/** 퇴장 애니메이션 시간 — styles.css의 panel-out과 맞춘다 */
const PANEL_EXIT_MS = 220;

export class Panel {
  private open = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly callbacks: PanelCallbacks,
  ) {}

  isOpen(): boolean {
    return this.open;
  }

  show(): void {
    this.open = true;
    this.root.hidden = false;
    // 등장 애니메이션: 열릴 때만 재생 (내용 전환에서는 재생하지 않음)
    this.root.classList.remove("panel-enter");
    void this.root.offsetWidth; // 리플로 강제로 애니메이션 재시작 허용
    this.root.classList.add("panel-enter");
  }

  hide(): void {
    this.open = false;
    this.root.classList.remove("panel-enter", "panel-exit");
    this.root.hidden = true;
  }

  /** 퇴장 애니메이션을 재생한 뒤 숨긴다. 창 축소는 이 뒤에 해야 잔상이 남지 않는다. */
  hideAnimated(): Promise<void> {
    this.open = false;
    this.root.classList.remove("panel-enter");
    this.root.classList.add("panel-exit");
    return new Promise((resolve) => {
      setTimeout(() => {
        this.hide();
        resolve();
      }, PANEL_EXIT_MS);
    });
  }

  private reset(title: string): HTMLElement {
    this.root.replaceChildren();
    const card = el("div", "panel-card");
    card.appendChild(el("h1", "panel-title", title));
    this.root.appendChild(card);
    return card;
  }

  /** ready: 스캔 시작 안내 */
  showIdle(): void {
    const card = this.reset("심야 점검실");
    card.classList.add("panel-idle");
    card.appendChild(
      el("p", "panel-note", "점검이 끝났다는 표시가 떠도, 이 버튼만은 누르지 마세요."),
    );
    card.appendChild(
      button("Button", "btn primary scan-button", () => this.callbacks.onStartScan()),
    );
  }

  showScanning(): void {
    const card = this.reset("스캔 중…");
    card.appendChild(el("div", "spinner"));
    card.appendChild(
      button("취소", "btn", () => this.callbacks.onCancelScan()),
    );
  }

  /** preview: 결과 요약 + 정리 대상 선택 + 명시적 승인 */
  showPreview(scan: ScanBundle): void {
    const card = this.reset("스캔 결과 · 미리보기");

    const summary = el("ul", "summary");
    summary.append(
      el(
        "li",
        undefined,
        `임시 파일 ${scan.temp.fileCount}개 · ${formatBytes(scan.temp.totalBytes)}`,
      ),
      el("li", undefined, `시작프로그램 ${scan.startup.length}개`),
      el("li", undefined, `서비스 ${scan.services.length}개`),
      el("li", undefined, `예약 작업 ${scan.tasks.length}개`),
      el("li", undefined, `프로세스 ${scan.processes.length}개`),
    );
    card.appendChild(summary);

    for (const error of scan.errors) {
      card.appendChild(el("p", "panel-error", `일부 항목 실패: ${error}`));
    }

    card.appendChild(
      el("h2", "panel-subtitle", "정리 후보 (큰 임시 파일 상위 항목)"),
    );
    const list = el("div", "candidates");
    const checkboxes: { box: HTMLInputElement; id: string; size: number }[] = [];
    for (const entry of scan.temp.entries.slice(0, 8)) {
      const row = el("label", "candidate");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = true;
      row.append(
        box,
        el("span", "candidate-path", entry.path),
        el("span", "candidate-size", formatBytes(entry.sizeBytes)),
      );
      list.appendChild(row);
      checkboxes.push({ box, id: entry.path, size: entry.sizeBytes });
    }
    card.appendChild(list);

    card.appendChild(
      el(
        "p",
        "panel-note",
        "실행은 모의(mock)로만 진행됩니다. 실제 파일은 삭제되지 않습니다.",
      ),
    );

    const actions = el("div", "actions");
    actions.append(
      button("승인 후 정리 실행 (모의)", "btn primary", () => {
        const selected = checkboxes.filter((c) => c.box.checked);
        this.callbacks.onApprove(
          selected.map((c) => c.id),
          selected.reduce((sum, c) => sum + c.size, 0),
        );
      }),
      button("취소", "btn", () => this.callbacks.onCancelScan()),
    );
    card.appendChild(actions);
  }

  showProgress(progress: Progress): void {
    const existing = this.root.querySelector<HTMLElement>(".progress-fill");
    if (existing) {
      existing.style.width = `${progress.percent}%`;
      const label = this.root.querySelector(".progress-label");
      if (label) label.textContent = `${progress.message} — ${progress.percent}%`;
      return;
    }
    const card = this.reset("정리 실행 중 (모의)");
    const bar = el("div", "progress-bar");
    const fill = el("div", "progress-fill");
    fill.style.width = `${progress.percent}%`;
    bar.appendChild(fill);
    card.append(
      bar,
      el("p", "progress-label", `${progress.message} — ${progress.percent}%`),
      button("취소", "btn", () => this.callbacks.onCancelCleanup()),
    );
  }

  showResult(result: CleanupResult): void {
    const titles = {
      success: "완료",
      warning: "부분 완료 · 주의",
      error: "실패",
    } as const;
    const card = this.reset(titles[result.outcome]);
    card.classList.add(`outcome-${result.outcome}`);
    card.append(
      el("p", "panel-note", result.message),
      el(
        "p",
        "panel-note",
        `처리 ${result.processed}건 · 건너뜀 ${result.skipped}건 (시뮬레이션)`,
      ),
    );
    const actions = el("div", "actions");
    if (result.outcome === "error") {
      actions.appendChild(
        button("재시도", "btn primary", () => this.callbacks.onRetry()),
      );
    }
    actions.appendChild(
      button("확인", "btn", () => this.callbacks.onDismiss()),
    );
    card.appendChild(actions);
  }

  showError(message: string): void {
    const card = this.reset("오류");
    card.classList.add("outcome-error");
    card.appendChild(el("p", "panel-error", message));
    const actions = el("div", "actions");
    actions.append(
      button("재시도", "btn primary", () => this.callbacks.onRetry()),
      button("닫기", "btn", () => this.callbacks.onDismiss()),
    );
    card.appendChild(actions);
  }
}
