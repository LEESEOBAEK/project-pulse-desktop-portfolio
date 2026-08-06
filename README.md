# Project Pulse Desktop

Windows용 Tauri 데스크톱 최적화 도우미의 공개 포트폴리오 버전입니다.
이 저장소는 기능 구조와 검증 가능한 MVP 흐름을 보여주기 위한 코드 샘플이며,
실제 시스템 변경은 수행하지 않습니다.

## Portfolio scope

- 읽기 전용 시스템 스캔 → 미리보기 → 사용자 승인 → mock 실행 → 결과 흐름
- 취소·재시도·부분 실패·진행률 UI
- `CharacterPack` 매니페스트와 PNG/SVG/정적 이미지 렌더러 어댑터
- 수면·기상·대기·패널·스캔 상태를 연결하는 상태 머신
- Tauri 명령 계층과 브라우저용 mock backend

실행 가능한 기본 팩은 저작권이 없는 SVG 플레이스홀더인
[`public/packs/placeholder-svg`](public/packs/placeholder-svg)입니다.

## Third-party character assets

원본 프로젝트에서 사용한 제3자 마스코트 IP의 PNG, 스프라이트 시퀀스, GIF, SVG,
매니페스트 및 기타 원본 파일은 이 공개 저장소에 포함하지 않습니다. 권리자가
승인한 캡처를 나중에 추가하는 경우에도 `docs/showcase/`에 감상용 이미지로만
배치하며, 원본 파일이나 다운로드 가능한 애셋 팩은 공개하지 않습니다.

## Run locally

```powershell
npm install
npm run tauri dev
```

프론트엔드만 실행하려면 `npm run dev`를 사용합니다. 다른 팩은 개발 서버 URL에
`?pack=<pack-id>`를 붙여 선택할 수 있습니다.

## Verify

```powershell
npm run test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo build --manifest-path src-tauri/Cargo.toml
```

## Structure

```text
src/app/          상태 머신과 도메인 타입
src/backend/      BackendApi, MockBackend, TauriBackend
src/mascot/       팩 로더와 렌더러 어댑터
src/ui/           스캔·승인·결과 패널
src-tauri/src/    Rust 명령 계층과 read-only scan
public/packs/     공개 SVG 플레이스홀더 팩
tests/            상태·팩·렌더러·백엔드 테스트
```

## Safety and license

MVP는 파일 삭제, 레지스트리 수정, 서비스 변경, 프로세스 강제 종료를 하지
않습니다. 스캔 결과에도 개인 경로를 저장하지 않습니다.

이 포트폴리오 저장소에는 별도 오픈소스 라이선스를 선언하지 않았습니다. 코드와
문서의 재사용은 저장소 소유자에게 문의해 주세요.
