# 가계부 PWA v3

Google Sheets를 원본으로 두고, 기기에 즉시 저장한 뒤 온라인일 때 안전하게 동기화하는 개인 가계부.

## 배포 순서

1. 기존 저장소의 `icon-192.png`, `icon-512.png`, `icon-maskable.png`는 그대로 유지한다.
2. 이 폴더의 `index.html`, `style.css`, `app.js`, `manifest.json`, `sw.js`, `screenshots/`를 GitHub Pages 저장소 루트에 덮어쓴다.
3. Google Sheets의 Apps Script에서 기존 코드를 `Code.gs` 전체 내용으로 교체한다.
4. `Code.gs` 맨 위 `TOKEN`을 기존에 쓰던 값으로 맞춘다.
5. Apps Script에서 `setup()`을 한 번 실행한다. 기존 거래 데이터는 보존되고 새 동기화 메타 컬럼만 추가된다.
6. 배포 관리에서 웹 앱을 **새 버전**으로 배포한다. 실행 계정은 나, 액세스 권한은 반드시 **모든 사용자**.
7. 앱 설정에서 `연결 확인` 후 `전체 다시 맞추기`를 한 번 실행한다.

## 중요

- 데이터 쓰기는 계속 **GET + query string**만 사용한다. POST로 바꾸지 않는다.
- 서비스워커 캐시는 `ledger-v3`이다.
- 기존 로컬 데이터 키(`lg.tx`, `lg.cfg`, `lg.presets`, `lg.lastpay`)는 그대로 읽고 v3 형식으로 마이그레이션한다.
- 삭제는 tombstone으로 동기화되고 서버 확인 전에는 로컬에서 버리지 않는다.
- JSON 백업은 BOM 없이 저장하고, 예전 BOM 포함 백업도 읽는다.
- `로컬 캐시 초기화`는 Google Sheets를 지우지 않는다.

## v3 핵심 변경

- 전송 중 재수정 경쟁 조건 제거, 스냅샷 ACK 방식
- `updated + deviceId` 충돌 판정과 서버 revision/cursor 증분 동기화
- 서버 LockService, strict validation, idempotent upsert
- timeout, retry/backoff, wrong-app/wrong-sheet 연결 차단
- 삭제 Undo, 작성 중 draft 복구, 중복 저장 및 한글 IME 오입력 방지
- 백업 검증/미리보기/최신 버전 병합
- 접근성, 터치 영역, 확대 허용, safe-area, landscape/multi-window 대응
- PWA shortcuts, screenshots, 동기화 진단/앱 버전 표시
