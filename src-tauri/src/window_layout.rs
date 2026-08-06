// 창 레이아웃: 창 크기는 항상 고정(런타임 리사이즈 없음 — 리사이즈 중
// WebView 리페인트 지연으로 캐릭터가 순간이동해 보이는 문제를 원천 제거).
// 대신 커서 위치를 폴링해 상호작용 영역 밖에서는 클릭을 통과시킨다.
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{PhysicalPosition, WebviewWindow};

/// 창 논리 크기 (항상 고정)
pub const WINDOW_SIZE: (f64, f64) = (680.0, 480.0);
/// 캐릭터 상호작용 영역(창 우하단 모서리 기준 논리 크기)
pub const CHARACTER_BOX: (f64, f64) = (280.0, 280.0);
pub const MARGIN_RIGHT: f64 = 16.0;
pub const MARGIN_BOTTOM: f64 = 72.0;
const CURSOR_POLL_MS: u64 = 60;

/// 모니터 좌표계(물리 픽셀)에서 우하단 위치를 계산한다. (requirements-v0.md QA-2)
pub fn bottom_right_position(
    monitor_origin: (i32, i32),
    monitor_size: (u32, u32),
    window_size: (u32, u32),
    scale: f64,
) -> (i32, i32) {
    let x = monitor_origin.0 + monitor_size.0 as i32
        - window_size.0 as i32
        - (MARGIN_RIGHT * scale).round() as i32;
    let y = monitor_origin.1 + monitor_size.1 as i32
        - window_size.1 as i32
        - (MARGIN_BOTTOM * scale).round() as i32;
    (x, y)
}

pub fn place_bottom_right(window: &WebviewWindow) -> tauri::Result<()> {
    if let Some(monitor) = window.primary_monitor()? {
        let screen = monitor.size();
        let win = window.outer_size()?;
        let (x, y) = bottom_right_position(
            (monitor.position().x, monitor.position().y),
            (screen.width, screen.height),
            (win.width, win.height),
            monitor.scale_factor(),
        );
        window.set_position(PhysicalPosition::new(x, y))?;
    }
    Ok(())
}

/// 커서가 상호작용 영역 안에 있는가.
/// 패널이 열려 있거나 캐릭터를 누르고 있으면 창 전체, 그 외에는 우하단 캐릭터
/// 박스만 상호작용한다. 누름 중에는 드래그가 캐릭터 박스 밖으로 진행돼도 클릭 통과가
/// 창 입력을 빼앗지 않는다.
pub fn cursor_in_interactive(
    cursor: (f64, f64),
    window_pos: (i32, i32),
    window_size: (u32, u32),
    scale: f64,
    panel_open: bool,
    character_press_active: bool,
) -> bool {
    let left = window_pos.0 as f64;
    let top = window_pos.1 as f64;
    let right = left + window_size.0 as f64;
    let bottom = top + window_size.1 as f64;

    let inside_window =
        cursor.0 >= left && cursor.0 < right && cursor.1 >= top && cursor.1 < bottom;
    if !inside_window {
        return false;
    }
    if panel_open || character_press_active {
        return true;
    }
    let box_width = CHARACTER_BOX.0 * scale;
    let box_height = CHARACTER_BOX.1 * scale;
    cursor.0 >= right - box_width && cursor.1 >= bottom - box_height
}

#[derive(Default)]
pub struct InteractionState {
    pub panel_open: AtomicBool,
    pub character_press_active: AtomicBool,
}

/// 패널 열림 상태 갱신 — 클릭 통과 판정에만 쓰인다 (창 크기는 바꾸지 않는다)
#[tauri::command]
pub fn set_panel_open(state: tauri::State<'_, Arc<InteractionState>>, open: bool) {
    state.panel_open.store(open, Ordering::Relaxed);
}

/// 캐릭터를 누르는 동안 클릭 통과를 중지한다. 프론트엔드는 mouseup·blur에서 반드시
/// false로 되돌려 일반적인 캐릭터 박스 클릭 통과 정책을 복원한다.
#[tauri::command]
pub fn set_character_press_active(
    state: tauri::State<'_, Arc<InteractionState>>,
    active: bool,
) {
    state
        .character_press_active
        .store(active, Ordering::Relaxed);
}

/// 커서 폴링 스레드: 상호작용 영역 밖이면 클릭을 데스크톱으로 통과시킨다.
pub fn spawn_cursor_watcher(window: WebviewWindow, state: Arc<InteractionState>) {
    std::thread::spawn(move || {
        let mut ignoring = false;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(CURSOR_POLL_MS));
            let (Ok(cursor), Ok(position), Ok(size), Ok(scale)) = (
                window.cursor_position(),
                window.outer_position(),
                window.outer_size(),
                window.scale_factor(),
            ) else {
                continue;
            };
            let inside = cursor_in_interactive(
                (cursor.x, cursor.y),
                (position.x, position.y),
                (size.width, size.height),
                scale,
                state.panel_open.load(Ordering::Relaxed),
                state.character_press_active.load(Ordering::Relaxed),
            );
            let should_ignore = !inside;
            if should_ignore != ignoring
                && window.set_ignore_cursor_events(should_ignore).is_ok()
            {
                ignoring = should_ignore;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bottom_right_respects_margins_and_scale() {
        // 1920x1080 모니터, 원점 (0,0), 창 680x480, 스케일 1.0
        let (x, y) = bottom_right_position((0, 0), (1920, 1080), (680, 480), 1.0);
        assert_eq!(x, 1920 - 680 - 16);
        assert_eq!(y, 1080 - 480 - 72);
    }

    #[test]
    fn bottom_right_scales_margins_for_dpi() {
        let (x, y) = bottom_right_position((0, 0), (2560, 1440), (560, 560), 2.0);
        assert_eq!(x, 2560 - 560 - 32);
        assert_eq!(y, 1440 - 560 - 144);
    }

    #[test]
    fn bottom_right_honors_monitor_origin() {
        let (x, _y) = bottom_right_position((1920, 0), (1920, 1080), (280, 280), 1.0);
        assert_eq!(x, 1920 + 1920 - 280 - 16);
    }

    // 창: (1000, 500) 원점, 680x480 물리(스케일 1.0)
    const POS: (i32, i32) = (1000, 500);
    const SIZE: (u32, u32) = (680, 480);

    #[test]
    fn cursor_outside_window_is_not_interactive() {
        assert!(!cursor_in_interactive((999.0, 600.0), POS, SIZE, 1.0, true, false));
        assert!(!cursor_in_interactive((1000.0, 981.0), POS, SIZE, 1.0, true, false));
    }

    #[test]
    fn panel_open_makes_whole_window_interactive() {
        assert!(cursor_in_interactive((1010.0, 510.0), POS, SIZE, 1.0, true, false));
        assert!(cursor_in_interactive((1650.0, 970.0), POS, SIZE, 1.0, true, false));
    }

    #[test]
    fn panel_closed_only_character_box_is_interactive() {
        // 우하단 280x280 박스: x >= 1000+680-280=1400, y >= 500+480-280=700
        assert!(cursor_in_interactive((1450.0, 750.0), POS, SIZE, 1.0, false, false));
        assert!(cursor_in_interactive((1400.0, 700.0), POS, SIZE, 1.0, false, false));
        // 왼쪽 패널 영역·위쪽은 통과
        assert!(!cursor_in_interactive((1100.0, 750.0), POS, SIZE, 1.0, false, false));
        assert!(!cursor_in_interactive((1450.0, 600.0), POS, SIZE, 1.0, false, false));
    }

    #[test]
    fn character_box_scales_with_dpi() {
        // 스케일 2.0: 박스 560x560 → x >= 1000+680-560=1120
        assert!(cursor_in_interactive((1150.0, 900.0), POS, SIZE, 2.0, false, false));
        assert!(!cursor_in_interactive((1100.0, 900.0), POS, SIZE, 2.0, false, false));
    }

    #[test]
    fn character_press_keeps_window_interactive_during_drag() {
        // 캐릭터에서 드래그를 시작한 뒤 커서가 창의 왼쪽으로 이동해도 mouseup까지
        // 클릭 통과가 켜지지 않아 startDragging 경로가 끊기지 않는다.
        assert!(cursor_in_interactive(
            (1100.0, 750.0),
            POS,
            SIZE,
            1.0,
            false,
            true
        ));
    }
}
