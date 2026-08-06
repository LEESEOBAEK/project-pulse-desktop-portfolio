import { describe, expect, test, vi } from "vitest";
import { Panel, type PanelCallbacks } from "../src/ui/panel";

function makePanel(): { root: HTMLElement; panel: Panel } {
  const root = document.createElement("div");
  root.hidden = true;
  const callbacks: PanelCallbacks = {
    onStartScan: vi.fn(),
    onApprove: vi.fn(),
    onCancelScan: vi.fn(),
    onCancelCleanup: vi.fn(),
    onRetry: vi.fn(),
    onDismiss: vi.fn(),
  };
  return { root, panel: new Panel(root, callbacks) };
}

describe("Panel — 표시/숨김과 등장 연출", () => {
  test("show는 패널을 드러내고 등장 애니메이션 클래스를 붙인다", () => {
    const { root, panel } = makePanel();
    panel.show();
    expect(root.hidden).toBe(false);
    expect(root.classList.contains("panel-enter")).toBe(true);
  });

  test("hide는 패널을 숨긴다", () => {
    const { root, panel } = makePanel();
    panel.show();
    panel.hide();
    expect(root.hidden).toBe(true);
    expect(panel.isOpen()).toBe(false);
  });

  test("hideAnimated는 퇴장 클래스를 붙였다가 애니메이션 후 숨긴다", async () => {
    vi.useFakeTimers();
    const { root, panel } = makePanel();
    panel.show();

    const hidePromise = panel.hideAnimated();
    expect(root.classList.contains("panel-exit")).toBe(true);
    expect(root.hidden).toBe(false); // 애니메이션 동안은 보인다

    await vi.runAllTimersAsync();
    await hidePromise;
    expect(root.hidden).toBe(true);
    expect(root.classList.contains("panel-exit")).toBe(false);
    expect(panel.isOpen()).toBe(false);
    vi.useRealTimers();
  });

  test("내용 전환(showScanning 등)은 등장 애니메이션을 다시 트리거하지 않는다", () => {
    const { root, panel } = makePanel();
    panel.show();
    root.classList.remove("panel-enter"); // 애니메이션 종료 상황을 흉내
    panel.showScanning();
    expect(root.classList.contains("panel-enter")).toBe(false);
  });
});
