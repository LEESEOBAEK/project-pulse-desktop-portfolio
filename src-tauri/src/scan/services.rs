// 서비스 조회: PowerShell Get-Service JSON 출력 파싱 (읽기 전용).
use serde::{Deserialize, Serialize};

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ServiceInfo {
    pub name: String,
    pub display_name: String,
    pub status: String,
}

#[derive(Deserialize)]
struct RawService {
    #[serde(rename = "Name")]
    name: String,
    #[serde(rename = "DisplayName")]
    display_name: String,
    #[serde(rename = "Status")]
    status: String,
}

/// `Get-Service | Select Name,DisplayName,Status(ToString)` JSON을 파싱한다.
pub fn parse_services_json(json: &str) -> Result<Vec<ServiceInfo>, String> {
    super::parse_json_list(json, |raw: RawService| ServiceInfo {
        name: raw.name,
        display_name: raw.display_name,
        status: raw.status,
    })
}

#[tauri::command]
pub async fn list_services() -> Result<Vec<ServiceInfo>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let json = super::run_powershell(
            "Get-Service | Select-Object Name,DisplayName,@{n='Status';e={$_.Status.ToString()}} | ConvertTo-Json -Compress",
        )?;
        parse_services_json(&json)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_services() {
        let json = r#"[{"Name":"Spooler","DisplayName":"Print Spooler","Status":"Running"}]"#;
        let list = parse_services_json(json).unwrap();
        assert_eq!(
            list[0],
            ServiceInfo {
                name: "Spooler".into(),
                display_name: "Print Spooler".into(),
                status: "Running".into()
            }
        );
    }

    #[test]
    fn parses_single_object() {
        let json = r#"{"Name":"A","DisplayName":"B","Status":"Stopped"}"#;
        assert_eq!(parse_services_json(json).unwrap().len(), 1);
    }
}
