// 도메인 타입: 스캔 결과·진행률·실행 결과.
// 이 모듈은 UI·마스코트·자산 경로를 알지 못한다.

export type TaskKind = "temp_cleanup" | "generic";

export interface TempFileEntry {
  path: string;
  sizeBytes: number;
}

export interface TempFileScan {
  entries: TempFileEntry[];
  totalBytes: number;
  fileCount: number;
  errors: string[];
}

export interface StartupItem {
  name: string;
  command: string;
  scope: "user" | "machine";
}

export interface ServiceInfo {
  name: string;
  displayName: string;
  status: string;
}

export interface ScheduledTask {
  name: string;
  path: string;
  state: string;
}

export interface ProcessInfo {
  name: string;
  pid: number;
  memBytes: number;
}

export interface CleanupSelection {
  kind: TaskKind;
  itemIds: string[];
  estimatedBytes: number;
}

export interface Progress {
  percent: number;
  message: string;
}

export type CleanupOutcome = "success" | "warning" | "error";

export interface CleanupResult {
  outcome: CleanupOutcome;
  processed: number;
  skipped: number;
  message: string;
  /** MVP는 항상 모의 실행이다. 실제 시스템 변경이 없음을 명시한다. */
  simulated: true;
}
