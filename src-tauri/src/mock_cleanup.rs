// mock 실행: 진행률 이벤트를 내는 시뮬레이션. 실제 파일·서비스는 절대 변경하지 않는다.
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::Emitter;

pub const PROGRESS_EVENT: &str = "cleanup://progress";
const STEP_MS: u64 = 150;

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CleanupSelection {
    pub kind: String,
    pub item_ids: Vec<String>,
    pub estimated_bytes: u64,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub percent: u32,
    pub message: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CleanupResult {
    pub outcome: String,
    pub processed: u32,
    pub skipped: u32,
    pub message: String,
    pub simulated: bool,
}

#[derive(Default)]
pub struct CleanupState {
    cancel: AtomicBool,
}

/// total개 항목을 처리할 때의 진행률 시퀀스 (마지막은 항상 100)
pub fn progress_percents(total: usize) -> Vec<u32> {
    let total = total.max(1);
    (1..=total).map(|i| (i * 100 / total) as u32).collect()
}

#[tauri::command]
pub async fn start_mock_cleanup(
    app: tauri::AppHandle,
    state: tauri::State<'_, CleanupState>,
    selection: CleanupSelection,
) -> Result<CleanupResult, String> {
    state.cancel.store(false, Ordering::SeqCst);
    let total = selection.item_ids.len().max(1);
    let percents = progress_percents(total);
    let mut processed: u32 = 0;

    for (index, percent) in percents.iter().enumerate() {
        tokio::time::sleep(Duration::from_millis(STEP_MS)).await;
        if state.cancel.load(Ordering::SeqCst) {
            return Ok(CleanupResult {
                outcome: "warning".into(),
                processed,
                skipped: (total - processed as usize) as u32,
                message: "사용자가 취소했습니다. 일부 항목만 시뮬레이션되었습니다.".into(),
                simulated: true,
            });
        }
        processed = (index + 1) as u32;
        app.emit(
            PROGRESS_EVENT,
            Progress {
                percent: *percent,
                message: format!("모의 정리 중 ({processed}/{total})"),
            },
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(CleanupResult {
        outcome: "success".into(),
        processed,
        skipped: 0,
        message: "모의 정리가 완료되었습니다. 실제 파일은 변경되지 않았습니다.".into(),
        simulated: true,
    })
}

#[tauri::command]
pub fn cancel_cleanup(state: tauri::State<'_, CleanupState>) {
    state.cancel.store(true, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percents_are_monotonic_and_end_at_100() {
        let percents = progress_percents(4);
        assert_eq!(percents, vec![25, 50, 75, 100]);
        for pair in percents.windows(2) {
            assert!(pair[0] <= pair[1]);
        }
    }

    #[test]
    fn empty_selection_still_completes() {
        assert_eq!(progress_percents(0), vec![100]);
    }

    #[test]
    fn cancel_flag_roundtrip() {
        let state = CleanupState::default();
        assert!(!state.cancel.load(Ordering::SeqCst));
        state.cancel.store(true, Ordering::SeqCst);
        assert!(state.cancel.load(Ordering::SeqCst));
    }
}
