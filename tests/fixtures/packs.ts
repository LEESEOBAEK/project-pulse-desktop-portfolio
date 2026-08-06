// 4가지 캐릭터 팩 픽스처: PNG 시퀀스, SVG, 정적 이미지, 다른 캐릭터.
// 모두 동일한 state_id 계약(01_sleep … 12_success)을 사용한다.

export const STATE_IDS = [
  "01_sleep",
  "01_to_02_wake_transition",
  "02_wake_up",
  "02_wake_to_02_02_transition",
  "02_02_standing_awake",
  "03_ready_idle",
  "03_panel_open_jump_turn_left_spatial_clean",
  "03_to_04_pull_window_from_subspace",
  "04_to_05_throw_window_expand",
  "04_awaiting_selection",
  "05_system_scan",
  "06_temp_file_cleanup",
  "07_startup_management",
  "08_process_inspection",
  "09_optimization_progress",
  "10_warning",
  "11_error_blocked",
  "12_success",
] as const;

function pngStates(): Record<string, unknown> {
  const states: Record<string, unknown> = {};
  for (const id of STATE_IDS) {
    states[id] = {
      type: "png_sequence",
      frame_template: `${id}/${id}_{frame:03}.png`,
      frame_count: 8,
      fps: 12,
      loop: id === "01_sleep",
      hold_ms: 0,
    };
  }
  return states;
}

function svgStates(): Record<string, unknown> {
  const states: Record<string, unknown> = {};
  for (const id of STATE_IDS) {
    states[id] = { type: "svg", src: `${id}.svg` };
  }
  return states;
}

/** 기존 토끼 PNG 시퀀스 팩 */
export const sequencePngPack = {
  pack_id: "sequence-png",
  version: "1.0.0",
  canvas: { width: 400, height: 300 },
  fallback_state: "03_ready_idle",
  states: pngStates(),
};

/** 상태별 SVG 팩 */
export const placeholderSvgPack = {
  pack_id: "placeholder-svg",
  version: "1.0.0",
  canvas: { width: 400, height: 300 },
  fallback_state: "03_ready_idle",
  states: svgStates(),
};

/** 정적 이미지 팩: 상태 일부 누락 → fallback_state로 강등되어야 한다 */
export const staticImagePack = {
  pack_id: "static-image",
  version: "1.0.0",
  canvas: { width: 200, height: 200 },
  fallback_state: "03_ready_idle",
  states: {
    "01_sleep": { type: "static_image", src: "sleep.png" },
    "03_ready_idle": { type: "static_image", src: "idle.png" },
    "05_system_scan": { type: "static_image", src: "scan.png" },
    "12_success": { type: "static_image", src: "done.png" },
  },
};

/** 다른 캐릭터 팩(포맷 혼합): 같은 state_id 계약이면 기능이 동일해야 한다 */
export const altCharacterPack = {
  pack_id: "alt-character",
  version: "2.0.0",
  canvas: { width: 320, height: 320 },
  fallback_state: "01_sleep",
  states: {
    ...svgStates(),
    "01_sleep": {
      type: "png_sequence",
      frame_template: "cat_sleep/{frame}.png",
      frame_count: 4,
      fps: 6,
      loop: true,
      hold_ms: 0,
    },
    "12_success": { type: "static_image", src: "cat_success.png" },
  },
};

export const ALL_PACKS = [
  sequencePngPack,
  placeholderSvgPack,
  staticImagePack,
  altCharacterPack,
];
