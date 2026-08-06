// 예약 작업 조회: PowerShell Get-ScheduledTask JSON 출력 파싱 (읽기 전용).
use serde::{Deserialize, Serialize};

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTask {
    pub name: String,
    pub path: String,
    pub state: String,
}

#[derive(Deserialize)]
struct RawTask {
    #[serde(rename = "TaskName")]
    task_name: String,
    #[serde(rename = "TaskPath")]
    task_path: String,
    #[serde(rename = "State")]
    state: String,
}

/// `Get-ScheduledTask | Select TaskName,TaskPath,State(ToString)` JSON을 파싱한다.
pub fn parse_scheduled_tasks_json(json: &str) -> Result<Vec<ScheduledTask>, String> {
    super::parse_json_list(json, |raw: RawTask| ScheduledTask {
        name: raw.task_name,
        path: raw.task_path,
        state: raw.state,
    })
}

#[tauri::command]
pub async fn list_scheduled_tasks() -> Result<Vec<ScheduledTask>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let json = super::run_powershell(
            "Get-ScheduledTask | Select-Object -First 60 TaskName,TaskPath,@{n='State';e={$_.State.ToString()}} | ConvertTo-Json -Compress",
        )?;
        parse_scheduled_tasks_json(&json)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tasks() {
        let json = r#"[{"TaskName":"NightlyBackup","TaskPath":"\\Vendor\\","State":"Ready"}]"#;
        let list = parse_scheduled_tasks_json(json).unwrap();
        assert_eq!(
            list[0],
            ScheduledTask {
                name: "NightlyBackup".into(),
                path: "\\Vendor\\".into(),
                state: "Ready".into()
            }
        );
    }

    #[test]
    fn parses_single_object() {
        let json = r#"{"TaskName":"A","TaskPath":"\\","State":"Disabled"}"#;
        assert_eq!(parse_scheduled_tasks_json(json).unwrap().len(), 1);
    }
}
