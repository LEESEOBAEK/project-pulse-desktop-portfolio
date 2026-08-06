// 스왑 계약 테스트: 캐릭터 팩(PNG 시퀀스·SVG·정적 이미지·다른 캐릭터)을 교체해도
// 기능 로직(상태 머신·백엔드 호출)이 전혀 변하지 않는다.
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  transition,
  mapAppStateToMascotState,
  type AppState,
  type AppEvent,
} from "../src/app/stateMachine";
import { createPack } from "../src/mascot/packLoader";
import { MockBackend } from "../src/backend/mockBackend";
import type { BackendApi } from "../src/backend/api";
import { ALL_PACKS, STATE_IDS } from "./fixtures/packs";

/** 제품 흐름 전체를 지나는 공통 이벤트 시나리오 */
const SCENARIO: AppEvent[] = [
  { type: "DOUBLE_CLICK" },
  { type: "WAKE_DONE" },
  { type: "START_SCAN" },
  { type: "SCAN_DONE" },
  { type: "APPROVE" },
  { type: "EXEC_DONE", outcome: "success" },
  { type: "DISMISS" },
];

/** 팩과 무관하게 백엔드를 호출하는 최소 컨트롤러 시뮬레이션 */
async function runFlow(backend: BackendApi, callLog: string[]): Promise<void> {
  await backend.scanTempFiles();
  callLog.push("scanTempFiles");
  await backend.listStartupItems();
  callLog.push("listStartupItems");
  await backend.startMockCleanup(
    { kind: "temp_cleanup", itemIds: ["a"], estimatedBytes: 10 },
    () => {},
  );
  callLog.push("startMockCleanup");
}

describe("캐릭터 팩 스왑 계약", () => {
  test("동일 이벤트 시나리오는 팩과 무관하게 동일한 상태·mascot 궤적을 만든다", async () => {
    const trajectories: string[] = [];
    const backendLogs: string[] = [];

    for (const manifest of ALL_PACKS) {
      const pack = createPack(manifest, "http://localhost/packs/x/");
      let state: AppState = "sleep";
      const trajectory: string[] = [state];
      const mascotTrajectory: string[] = [mapAppStateToMascotState(state)];

      for (const event of SCENARIO) {
        state = transition(state, event);
        trajectory.push(state);
        const mascotId = mapAppStateToMascotState(state, "temp_cleanup");
        mascotTrajectory.push(mascotId);
        // 모든 상태가 이 팩에서 렌더 가능한 visual로 해석되어야 한다
        expect(pack.resolveState(mascotId)).toBeTruthy();
      }

      const callLog: string[] = [];
      await runFlow(new MockBackend(), callLog);
      backendLogs.push(callLog.join(">"));
      trajectories.push(trajectory.join(">") + "|" + mascotTrajectory.join(">"));
    }

    // 4개 팩 모두 완전히 동일한 궤적과 백엔드 호출
    expect(new Set(trajectories).size).toBe(1);
    expect(new Set(backendLogs).size).toBe(1);
  });

  test("14개 state_id 전부가 모든 팩에서 렌더 가능한 visual로 해석된다(누락은 fallback)", () => {
    for (const manifest of ALL_PACKS) {
      const pack = createPack(manifest, "http://localhost/packs/x/");
      for (const stateId of STATE_IDS) {
        const visual = pack.resolveState(stateId);
        expect(visual, `${manifest.pack_id}:${stateId}`).toBeTruthy();
        if (visual.type === "png_sequence") {
          expect(visual.frames.length).toBeGreaterThan(0);
        } else {
          expect(visual.src.length).toBeGreaterThan(0);
        }
      }
    }
  });

  test("기능 모듈 소스에 팩 자산 경로·파일명 리터럴이 없다", () => {
    // state_id(01_sleep 등)는 팩과 공유하는 계약이므로 허용.
    // 금지 대상은 자산 파일명·경로: *.png, *.svg, packs/, 특정 캐릭터 이름.
    const functionalDirs = ["src/app", "src/backend"];
    const forbidden = [/\.png/, /\.svg/, /packs\//];
    for (const dir of functionalDirs) {
      for (const file of readdirSync(join(process.cwd(), dir))) {
        const source = readFileSync(join(process.cwd(), dir, file), "utf8");
        for (const pattern of forbidden) {
          expect(pattern.test(source), `${dir}/${file} contains ${pattern}`).toBe(
            false,
          );
        }
      }
    }
  });
});
