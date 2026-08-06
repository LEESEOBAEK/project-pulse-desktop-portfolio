// BackendApi: UI가 의존하는 유일한 백엔드 경계.
// 구현체(Tauri/Mock)를 교체해도 상태 머신·UI 코드는 변하지 않는다.
import type {
  CleanupResult,
  CleanupSelection,
  Progress,
  ProcessInfo,
  ScheduledTask,
  ServiceInfo,
  StartupItem,
  TempFileScan,
} from "../app/types";

export interface BackendApi {
  /** 읽기 전용 스캔 — 시스템을 변경하지 않는다 */
  scanTempFiles(): Promise<TempFileScan>;
  listStartupItems(): Promise<StartupItem[]>;
  listServices(): Promise<ServiceInfo[]>;
  listScheduledTasks(): Promise<ScheduledTask[]>;
  listProcesses(): Promise<ProcessInfo[]>;
  /** 모의 실행 — 진행률 콜백과 결과. 실제 삭제·변경 없음 */
  startMockCleanup(
    selection: CleanupSelection,
    onProgress: (progress: Progress) => void,
  ): Promise<CleanupResult>;
  cancelCleanup(): Promise<void>;
}
