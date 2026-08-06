// MockBackend: 고정 데이터와 타이머 기반 모의 실행.
// 브라우저 dev·테스트에서 Tauri 없이 전체 흐름을 검증한다.
import type { BackendApi } from "./api";
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

const STEP_MS = 120;

export class MockBackend implements BackendApi {
  private cancelled = false;

  async scanTempFiles(): Promise<TempFileScan> {
    const entries = [
      { path: "TEMP/setup_cache.tmp", sizeBytes: 48_000_000 },
      { path: "TEMP/old_installer.log", sizeBytes: 12_500_000 },
      { path: "TEMP/render_cache.bin", sizeBytes: 8_200_000 },
    ];
    return {
      entries,
      totalBytes: 96_400_000,
      fileCount: 132,
      errors: [],
    };
  }

  async listStartupItems(): Promise<StartupItem[]> {
    return [
      { name: "CloudSyncHelper", command: "helper.exe --background", scope: "user" },
      { name: "UpdaterService", command: "updater.exe /quiet", scope: "machine" },
    ];
  }

  async listServices(): Promise<ServiceInfo[]> {
    return [
      { name: "Spooler", displayName: "Print Spooler", status: "Running" },
      { name: "WSearch", displayName: "Windows Search", status: "Running" },
    ];
  }

  async listScheduledTasks(): Promise<ScheduledTask[]> {
    return [
      { name: "NightlyBackup", path: "\\Vendor\\", state: "Ready" },
      { name: "TelemetryUpload", path: "\\Vendor\\", state: "Disabled" },
    ];
  }

  async listProcesses(): Promise<ProcessInfo[]> {
    return [
      { name: "browser.exe", pid: 4321, memBytes: 512_000_000 },
      { name: "editor.exe", pid: 5678, memBytes: 300_000_000 },
    ];
  }

  startMockCleanup(
    selection: CleanupSelection,
    onProgress: (progress: Progress) => void,
  ): Promise<CleanupResult> {
    this.cancelled = false;
    const total = Math.max(selection.itemIds.length, 1);

    return new Promise((resolve) => {
      let processed = 0;
      const timer = setInterval(() => {
        if (this.cancelled) {
          clearInterval(timer);
          resolve({
            outcome: "warning",
            processed,
            skipped: total - processed,
            message: "사용자가 취소했습니다. 일부 항목만 시뮬레이션되었습니다.",
            simulated: true,
          });
          return;
        }
        processed += 1;
        onProgress({
          percent: Math.round((processed / total) * 100),
          message: `모의 정리 중 (${processed}/${total})`,
        });
        if (processed >= total) {
          clearInterval(timer);
          resolve({
            outcome: "success",
            processed,
            skipped: 0,
            message: "모의 정리가 완료되었습니다. 실제 파일은 변경되지 않았습니다.",
            simulated: true,
          });
        }
      }, STEP_MS);
    });
  }

  async cancelCleanup(): Promise<void> {
    this.cancelled = true;
  }
}
