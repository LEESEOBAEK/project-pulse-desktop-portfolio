// 시작프로그램 조회: 레지스트리 Run 키 읽기 전용 열람.
use serde::Serialize;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StartupItem {
    pub name: String,
    pub command: String,
    pub scope: String,
}

/// (이름, 명령) 쌍을 StartupItem 목록으로 변환한다. 빈 이름은 제외한다.
pub fn collect_items(
    values: impl Iterator<Item = (String, String)>,
    scope: &str,
) -> Vec<StartupItem> {
    values
        .filter(|(name, _)| !name.is_empty())
        .map(|(name, command)| StartupItem {
            name,
            command,
            scope: scope.to_string(),
        })
        .collect()
}

#[cfg(windows)]
fn read_run_key(hive: winreg::HKEY, scope: &str) -> Vec<StartupItem> {
    use winreg::enums::KEY_READ;
    use winreg::RegKey;

    let root = RegKey::predef(hive);
    match root.open_subkey_with_flags(
        r"Software\Microsoft\Windows\CurrentVersion\Run",
        KEY_READ,
    ) {
        Ok(key) => collect_items(
            key.enum_values()
                .flatten()
                .map(|(name, value)| (name, value.to_string())),
            scope,
        ),
        Err(_) => Vec::new(),
    }
}

fn read_all_startup_items() -> Vec<StartupItem> {
    #[cfg(windows)]
    {
        use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
        let mut items = read_run_key(HKEY_CURRENT_USER, "user");
        items.extend(read_run_key(HKEY_LOCAL_MACHINE, "machine"));
        items
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

#[tauri::command]
pub async fn list_startup_items() -> Result<Vec<StartupItem>, String> {
    tauri::async_runtime::spawn_blocking(read_all_startup_items)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collects_named_values_with_scope() {
        let values = vec![
            ("Helper".to_string(), "helper.exe --bg".to_string()),
            (String::new(), "ignored.exe".to_string()),
        ];
        let items = collect_items(values.into_iter(), "user");
        assert_eq!(items.len(), 1);
        assert_eq!(
            items[0],
            StartupItem {
                name: "Helper".into(),
                command: "helper.exe --bg".into(),
                scope: "user".into()
            }
        );
    }
}
