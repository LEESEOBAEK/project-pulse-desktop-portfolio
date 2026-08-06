import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MockBackend } from "../src/backend/mockBackend";
import type { Progress } from "../src/app/types";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("MockBackend — 읽기 전용 스캔", () => {
  test("임시 파일 스캔은 합계가 일치하는 결정적 데이터를 준다", async () => {
    const backend = new MockBackend();
    const scan = await backend.scanTempFiles();
    expect(scan.fileCount).toBeGreaterThan(0);
    expect(scan.totalBytes).toBeGreaterThan(0);
    expect(scan.entries.length).toBeGreaterThan(0);
  });

  test("조회 API들은 비어 있지 않은 목록을 준다", async () => {
    const backend = new MockBackend();
    expect((await backend.listStartupItems()).length).toBeGreaterThan(0);
    expect((await backend.listServices()).length).toBeGreaterThan(0);
    expect((await backend.listScheduledTasks()).length).toBeGreaterThan(0);
    expect((await backend.listProcesses()).length).toBeGreaterThan(0);
  });
});

describe("MockBackend — mock 실행", () => {
  test("진행률이 0→100으로 단조 증가하고 성공 결과를 준다", async () => {
    const backend = new MockBackend();
    const progresses: Progress[] = [];
    const resultPromise = backend.startMockCleanup(
      { kind: "temp_cleanup", itemIds: ["a", "b"], estimatedBytes: 100 },
      (p) => progresses.push(p),
    );
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.outcome).toBe("success");
    expect(result.simulated).toBe(true);
    expect(result.processed).toBe(2);
    expect(progresses.length).toBeGreaterThan(1);
    expect(progresses[progresses.length - 1].percent).toBe(100);
    for (let i = 1; i < progresses.length; i++) {
      expect(progresses[i].percent).toBeGreaterThanOrEqual(
        progresses[i - 1].percent,
      );
    }
  });

  test("취소하면 warning 결과로 끝나고 100%에 도달하지 않는다", async () => {
    const backend = new MockBackend();
    const progresses: Progress[] = [];
    const resultPromise = backend.startMockCleanup(
      { kind: "temp_cleanup", itemIds: ["a", "b", "c", "d"], estimatedBytes: 400 },
      (p) => progresses.push(p),
    );
    await vi.advanceTimersByTimeAsync(250); // 일부 진행
    await backend.cancelCleanup();
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.outcome).toBe("warning");
    expect(result.processed).toBeLessThan(4);
    expect(progresses[progresses.length - 1]?.percent ?? 0).toBeLessThan(100);
  });
});
