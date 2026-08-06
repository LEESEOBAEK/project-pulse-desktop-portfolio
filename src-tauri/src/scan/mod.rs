// 읽기 전용 스캔 명령 계층. 어떤 명령도 시스템 상태를 변경하지 않는다.
pub mod processes;
pub mod scheduled_tasks;
pub mod services;
pub mod startup;
pub mod temp_files;

use std::process::Command;

/// PowerShell `ConvertTo-Json`은 항목이 하나면 배열 대신 단일 객체를 출력한다.
/// 두 형태 모두 Vec으로 파싱한다.
pub fn parse_json_list<R, T, F>(json: &str, map: F) -> Result<Vec<T>, String>
where
    R: serde::de::DeserializeOwned,
    F: Fn(R) -> T,
{
    let trimmed = json.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    let value: serde_json::Value =
        serde_json::from_str(trimmed).map_err(|e| e.to_string())?;
    let raws: Vec<R> = if value.is_array() {
        serde_json::from_value(value).map_err(|e| e.to_string())?
    } else {
        vec![serde_json::from_value(value).map_err(|e| e.to_string())?]
    };
    Ok(raws.into_iter().map(map).collect())
}

/// PowerShell을 읽기 전용 조회 용도로 실행하고 UTF-8 stdout을 돌려준다.
pub fn run_powershell(script: &str) -> Result<String, String> {
    let wrapped = format!(
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; {script}"
    );
    let mut command = Command::new("powershell");
    command.args(["-NoProfile", "-NonInteractive", "-Command", &wrapped]);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let output = command.output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned());
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}
