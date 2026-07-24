# 주간 유형테스트 파이프라인 — cron 자동화

이 문서는 **실데이터 수집 → 초안 생성 → 승인 대기열 등록**까지 무인 자동화하는
launchd cron 킷의 설치/운영 가이드다. 게이트 설계 자체(QG0~QG6)는
[quiz-loopgate.md](quiz-loopgate.md)가 정본이고, 이 문서는 그 파이프라인을
"누가 몇 시에 돌리는가"만 다룬다.

## 자동화 범위 (경계)

- **자동화됨**: 실데이터 핫아이템 수집(`scripts/quiz-dump-hot-items.js`) →
  AI 퀴즈 초안 생성 + 루프게이트(QG1~QG4) 통과 → `decision_queue` 승인 대기열
  등록(`node src/quiz/weekly.js run`).
- **자동화되지 않음 — 사람 전용**: 발행(`node src/quiz/weekly.js approve
  <slug>`). QG5는 매니페스트에 `no_go: external_publish`로 고정돼 있고,
  `quiz-weekly-cron.sh`는 `approve`를 어떤 경로로도 호출하지 않는다. 초안이
  쌓이면 David가 직접 검토 후 승인해야 `/q/<slug>`로 공개된다.
- cron이 실패해도(수집 0건, 루프게이트 예산 소진 등) 자동으로 재시도하거나
  우회하지 않는다 — 실패 알림만 뜨고, 사람이 원인을 보고 다음 주기 또는
  수동 재실행을 판단한다.

## 전제

- 이 저장소가 재부팅에도 살아남는 **영구 클론 경로**에 있어야 한다 (아래
  `__REPO_DIR__`가 그 경로). 스크래치/임시 디렉토리에 두면 launchd가 매번
  존재하지 않는 경로를 호출하게 된다.
- macOS, Node.js >= 22 (package.json `engines.node`), `launchctl`/`security`/
  `plutil`은 시스템 기본 제공.
- 승인 대기 알림은 `osascript display notification`을 쓰므로, cron을 실행하는
  사용자 세션에 GUI 로그인이 돼 있어야 알림이 실제로 뜬다(완전 헤드리스
  서버에서는 알림이 조용히 실패하지만 파이프라인 자체는 계속 진행된다).

## 1) Keychain에 Anthropic API 키 저장 (David, 최초 1회)

`quiz-weekly-cron.sh`는 매 실행 시 macOS Keychain에서
`security find-generic-password -s wrc-quiz-anthropic -w`로 키를 읽어
`ANTHROPIC_API_KEY`로 export한다. 키가 없으면 경고만 남기고
`src/quiz/generate.js`의 결정적 템플릿 폴백으로 계속 진행한다(파이프라인은
막히지 않음 — 다만 AI 생성 대신 템플릿 퀴즈가 나온다).

터미널에서 아래 명령을 실행하고 **프롬프트가 뜨면 그때 키를 입력**한다.
커맨드라인 인자로 키를 넘기면 셸 히스토리/프로세스 목록에 평문으로 남으니
절대 그렇게 하지 말 것:

```sh
security add-generic-password -s wrc-quiz-anthropic -a "$USER" -w
```

(`-w` 뒤에 값을 안 주면 터미널이 값을 프롬프트로 요청한다. 키가 이미
있으면 `-U` 플래그를 추가해 갱신: `security add-generic-password -s
wrc-quiz-anthropic -a "$USER" -U -w`)

확인:

```sh
security find-generic-password -s wrc-quiz-anthropic -w
```

## 2) plist 설치

`scripts/com.wrc.quiz-weekly.plist`는 템플릿이다 — `__REPO_DIR__`와
`__HOME__` 플레이스홀더를 실제 경로로 치환한 사본을 만들어 설치한다.

```sh
REPO_DIR="/절대/경로/ai-command-bus"     # 이 저장소의 영구 클론 경로
PLIST_NAME="com.wrc.quiz-weekly"

sed -e "s#__REPO_DIR__#${REPO_DIR}#g" -e "s#__HOME__#${HOME}#g" \
  "${REPO_DIR}/scripts/${PLIST_NAME}.plist" \
  > "${HOME}/Library/LaunchAgents/${PLIST_NAME}.plist"

plutil -lint "${HOME}/Library/LaunchAgents/${PLIST_NAME}.plist"   # 문법 확인

launchctl bootstrap "gui/$(id -u)" "${HOME}/Library/LaunchAgents/${PLIST_NAME}.plist"
```

실행 주기: 매주 **월요일 09:30 (로컬 시간대 = KST)**. `RunAtLoad`는
`false`이므로 설치 직후 즉시 실행되지 않는다 — 다음 월요일 09:30에 처음
돈다. 지금 당장 한 번 돌려보고 싶다면 [수동 실행](#수동-실행--진단)을 쓴다.

## 3) plist 제거

```sh
PLIST_NAME="com.wrc.quiz-weekly"
launchctl bootout "gui/$(id -u)" "${HOME}/Library/LaunchAgents/${PLIST_NAME}.plist"
rm -f "${HOME}/Library/LaunchAgents/${PLIST_NAME}.plist"
```

## 로그 위치

`~/Library/Logs/quiz-weekly.log` — launchd가 stdout/stderr를 그대로
리다이렉트한다. `quiz-weekly-cron.sh`는 수집 소스별 건수, 통과한 토픽,
루프게이트 판정, 초안 slug까지 전부 이 로그 한 파일에 남긴다. 여러 주가
쌓이며 로그가 계속 append되므로, 필요하면 `logrotate`류나 수동 정리를
David가 별도로 판단한다(이 킷은 로테이션을 하지 않는다).

## 수동 실행 / 진단

launchd 스케줄을 기다리지 않고 지금 바로 한 번 돌려보려면:

```sh
"${REPO_DIR}/scripts/quiz-weekly-cron.sh"
```

이 스크립트는 자기 위치 기준으로 `REPO_DIR`을 계산하므로 어느 디렉토리에서
실행해도 무방하다. 성공하면 macOS 알림("주간 퀴즈 초안" — 승인 대기 제목/
slug 포함)이 뜨고, 실패하면 실패 알림 + non-zero exit로 끝난다.

승인 대기 목록만 다시 보고 싶으면:

```sh
cd "${REPO_DIR}" && node src/quiz/weekly.js queue
```

승인(사람만 실행 — 스크립트가 절대 대신 호출하지 않음):

```sh
cd "${REPO_DIR}" && node src/quiz/weekly.js approve <slug>
```

launchd에 등록된 작업이 다음에 언제 도는지 확인:

```sh
launchctl print "gui/$(id -u)/com.wrc.quiz-weekly"
```
