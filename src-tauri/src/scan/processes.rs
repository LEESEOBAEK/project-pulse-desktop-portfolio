// 프로세스 조회: PowerShell Get-Process JSON 출력 파싱 (읽기 전용).
use serde::{Deserialize, Serialize};

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    pub name: String,
    pub pid: u32,
    pub mem_bytes: u64,
}

#[derive(Deserialize)]
struct RawProcess {
    #[serde(rename = "Name")]
    name: String,
    #[serde(rename = "Id")]
    id: u32,
    #[serde(rename = "WS")]
    ws: u64,
}

/// `Get-Process | Select-Object Name,Id,WS | ConvertTo-Json` 출력을 파싱한다.
/// 항목이 하나면 PowerShell이 배열 대신 단일 객체를 출력하는 것도 처리한다.
pub fn parse_processes_json(json: &str) -> Result<Vec<ProcessInfo>, String> {
    super::parse_json_list(json, |raw: RawProcess| ProcessInfo {
        name: raw.name,
        pid: raw.id,
        mem_bytes: raw.ws,
    })
}

#[tauri::command]
pub async fn list_processes() -> Result<Vec<ProcessInfo>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let json = super::run_powershell(
            "Get-Process | Sort-Object WS -Descending | Select-Object -First 40 Name,Id,WS | ConvertTo-Json -Compress",
        )?;
        parse_processes_json(&json)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_array_output() {
        let json = r#"[{"Name":"browser","Id":4321,"WS":512000000},{"Name":"editor","Id":5678,"WS":300000000}]"#;
        let list = parse_processes_json(json).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(
            list[0],
            ProcessInfo { name: "browser".into(), pid: 4321, mem_bytes: 512000000 }
        );
    }

    #[test]
    fn parses_single_object_output() {
        let json = r#"{"Name":"only","Id":1,"WS":1000}"#;
        let list = parse_processes_json(json).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "only");
    }

    #[test]
    fn rejects_invalid_json() {
        assert!(parse_processes_json("not json").is_err());
    }
}
