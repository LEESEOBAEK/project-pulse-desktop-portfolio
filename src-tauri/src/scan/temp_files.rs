// 임시 파일 스캔: 디렉터리 트리를 읽기 전용으로 걷는다.
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TempFileEntry {
    pub path: String,
    pub size_bytes: u64,
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct TempFileScan {
    pub entries: Vec<TempFileEntry>,
    pub total_bytes: u64,
    pub file_count: u64,
    pub errors: Vec<String>,
}

/// 실경로 기준으로 TEMP 루트 안에 있는, 아직 방문하지 않은 디렉터리인지 판단한다.
/// 심볼릭 링크·접합점이 TEMP 밖이나 이미 방문한 디렉터리를 가리켜도 재귀하지 않는다.
fn queue_canonical_dir(
    candidate: PathBuf,
    canonical_root: Option<&Path>,
    visited_dirs: &mut HashSet<PathBuf>,
) -> bool {
    canonical_root.is_none_or(|root| candidate.starts_with(root)) && visited_dirs.insert(candidate)
}

fn should_visit_dir(
    path: &Path,
    canonical_root: Option<&Path>,
    visited_dirs: &mut HashSet<PathBuf>,
) -> bool {
    match std::fs::canonicalize(path) {
        Ok(candidate) => queue_canonical_dir(candidate, canonical_root, visited_dirs),
        // 권한 등으로 실경로를 얻지 못한 경우에는 기존처럼 read_dir에서 오류를 수집한다.
        Err(_) => true,
    }
}

/// root 이하의 파일 개수·총 크기를 집계하고 크기 상위 top_n 항목을 남긴다.
pub fn scan_dir(root: &Path, top_n: usize) -> TempFileScan {
    let mut scan = TempFileScan::default();
    let mut stack = vec![root.to_path_buf()];
    let canonical_root = std::fs::canonicalize(root).ok();
    let mut visited_dirs = HashSet::new();
    if let Some(root) = canonical_root.as_ref() {
        visited_dirs.insert(root.clone());
    }

    while let Some(dir) = stack.pop() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(error) => {
                scan.errors.push(format!("{}: {error}", dir.display()));
                continue;
            }
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(error) => {
                    scan.errors.push(format!("{}: {error}", path.display()));
                    continue;
                }
            };
            // 링크 자체도 대상 파일로 집계하지 않는다. 링크를 따라가면 TEMP 밖 파일이나
            // 자기 자신을 가리키는 디렉터리를 순회할 수 있다.
            if file_type.is_symlink() {
                continue;
            }
            match entry.metadata() {
                Ok(meta) if meta.is_dir() => {
                    if should_visit_dir(&path, canonical_root.as_deref(), &mut visited_dirs) {
                        stack.push(path);
                    }
                }
                Ok(meta) => {
                    scan.file_count += 1;
                    scan.total_bytes += meta.len();
                    scan.entries.push(TempFileEntry {
                        path: path.display().to_string(),
                        size_bytes: meta.len(),
                    });
                }
                Err(error) => {
                    scan.errors.push(format!("{}: {error}", path.display()));
                }
            }
        }
    }

    scan.entries.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    scan.entries.truncate(top_n);
    scan
}

#[tauri::command]
pub async fn scan_temp_files() -> Result<TempFileScan, String> {
    tauri::async_runtime::spawn_blocking(|| scan_dir(&std::env::temp_dir(), 50))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn scan_dir_counts_files_and_keeps_top_entries() {
        let root = std::env::temp_dir().join(format!(
            "pulse_scan_test_{}",
            std::process::id()
        ));
        let nested = root.join("nested");
        fs::create_dir_all(&nested).unwrap();
        fs::write(root.join("big.tmp"), vec![0u8; 3000]).unwrap();
        fs::write(root.join("small.tmp"), vec![0u8; 100]).unwrap();
        fs::write(nested.join("mid.tmp"), vec![0u8; 500]).unwrap();

        let scan = scan_dir(&root, 2);

        fs::remove_dir_all(&root).unwrap();

        assert_eq!(scan.file_count, 3);
        assert_eq!(scan.total_bytes, 3600);
        assert_eq!(scan.entries.len(), 2);
        assert!(scan.entries[0].size_bytes >= scan.entries[1].size_bytes);
        assert_eq!(scan.entries[0].size_bytes, 3000);
        assert!(scan.errors.is_empty());
    }

    #[test]
    fn scan_dir_records_error_for_missing_root() {
        let scan = scan_dir(Path::new("Z:/definitely/missing/dir"), 5);
        assert_eq!(scan.file_count, 0);
        assert_eq!(scan.errors.len(), 1);
    }

    #[test]
    fn canonical_directory_queue_rejects_escapes_and_cycles() {
        let root = PathBuf::from("C:/temp/pulse-root");
        let mut visited = HashSet::new();

        assert!(queue_canonical_dir(
            root.join("nested"),
            Some(&root),
            &mut visited,
        ));
        assert!(!queue_canonical_dir(
            root.join("nested"),
            Some(&root),
            &mut visited,
        ));
        assert!(!queue_canonical_dir(
            PathBuf::from("C:/temp/outside"),
            Some(&root),
            &mut visited,
        ));
    }
}
