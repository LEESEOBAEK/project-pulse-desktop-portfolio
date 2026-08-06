// TauriBackend: Rust 명령 계층으로 위임하는 BackendApi 구현체.
// Rust 쪽 직렬화가 camelCase이므로 추가 변환은 필요 없다.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
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

const PROGRESS_EVENT = "cleanup://progress";

export function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export class TauriBackend implements BackendApi {
  scanTempFiles(): Promise<TempFileScan> {
    return invoke<TempFileScan>("scan_temp_files");
  }

  listStartupItems(): Promise<StartupItem[]> {
    return invoke<StartupItem[]>("list_startup_items");
  }

  listServices(): Promise<ServiceInfo[]> {
    return invoke<ServiceInfo[]>("list_services");
  }

  listScheduledTasks(): Promise<ScheduledTask[]> {
    return invoke<ScheduledTask[]>("list_scheduled_tasks");
  }

  listProcesses(): Promise<ProcessInfo[]> {
    return invoke<ProcessInfo[]>("list_processes");
  }

  async startMockCleanup(
    selection: CleanupSelection,
    onProgress: (progress: Progress) => void,
  ): Promise<CleanupResult> {
    let unlisten: UnlistenFn | undefined;
    try {
      unlisten = await listen<Progress>(PROGRESS_EVENT, (event) =>
        onProgress(event.payload),
      );
      return await invoke<CleanupResult>("start_mock_cleanup", { selection });
    } finally {
      unlisten?.();
    }
  }

  cancelCleanup(): Promise<void> {
    return invoke("cancel_cleanup");
  }
}

/** 패널 열림 상태를 알린다 — 창 크기는 고정이고, 클릭 통과 판정에만 쓰인다 */
export function setPanelOpen(open: boolean): Promise<void> {
  return invoke("set_panel_open", { open });
}

/** 캐릭터를 누르는 동안 클릭 통과를 멈춰 드래그 입력이 끊기지 않게 한다. */
export function setCharacterPressActive(active: boolean): Promise<void> {
  return invoke("set_character_press_active", { active });
}
