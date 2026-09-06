# NH128 아이폰 알림 연결 보완

- 안정 ID: `NOWHOT-IPHONE-PUSH-001`
- 변경 레코드: `DEVCHG-NOWHOT-20260907-215`
- 입력 분류: NH127 수리의 추가 장애 제보/확정 수리 지시. Root 책임, 기존 승인 안에서 아이폰 연결 조건과 실제 코드를 검증한다.
- 현재 상태: 구현·집중 검사·운영 반영·공개 안내 확인 완료. 아이폰 설치 상태 답변과 실제 기기 수신은 미확인이다.

## 확인한 사실과 원인 범위

- 08:42:27 KST 운영 조회에서 FCM 구독2, 빈 암호화 키를 가진 다른 endpoint 기록2, Apple push 구독0이었다. 개인정보·전체 endpoint·키는 출력하지 않고 서비스 호스트별 수만 집계했다. Apple 수신 연결이 저장되지 않은 상태이며, 사용자가 어느 상태로 열었는지 또는 개인 기기의 설치/권한을 이 집계로 단정하지 않는다.
- [Apple WebKit 안내](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)와 [한국어 설치 안내](https://support.apple.com/ko-kr/guide/iphone/iphea86e5236/ios)에 따르면 iOS/iPadOS16.4 이상에서 홈 화면 웹앱을 열고 직접 알림을 허용해야 한다. 일반 Safari/인앱 브라우저 방문만으로는 푸시 연결을 만들 수 없다. 최신 iOS에 ‘웹 앱으로 열기’가 보이면 켜야 한다.
- 실제 Today HTML에는 manifest/apple-web-app-capable/touch-icon 연결이 전부 없었고 Live에만 있었다. Today를 홈 화면 앱으로 추가하는 설정을 기존 Live와 맞췄다. 기존 manifest의 /live 시작 주소·scope·앱 identity는 바꾸지 않아 이미 설치된 앱을 별도 앱으로 만들지 않는다.
- 기존 공용 helper는 미지원 환경에 일반적인 ‘지원하지 않음’만 표시했다. 이제 아이폰·iPad 데스크톱 UA/홈 화면 상태에 맞는 설치 절차를 두 메뉴에서 지속 표시한다. 실제 기능 지원 여부로 허용하며 UA로 지원 API를 차단하지 않는다. 거부 상태에는 아이폰 설정 경로를 안내하고 자동 허용/재요청하지 않는다. 오류 설명이 버튼 이름을 길게 대체하지 않는다.
- [Apple Web Push 전송 문서](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)의 VAPID 조항은 JWT를 한 시간보다 자주 갱신하지 않도록 요구한다. 기존 sendPush는 매번 다시 서명했다. 공통 sendPush가 origin·키·subject별1시간 재사용하고 만료 항목을 정리하게 했다. 기존12시간 exp/매 메시지 암호화는 유지한다. 프로세스 재시작/여러 프로세스 사이의 캐시는 공유되지 않는다. **Apple 구독0의 원인을 JWT로 단정하지 않는다.**

## 검사·협업

- 공용 클라이언트/인라인17/17 PASS, 기존 구독 복원·OS 알림·아이폰 설치 안내 브라우저3/3 PASS. iPhone/iPad 일반탭에서 구독/권한 요청0, 설치된 환경과 거부/지원안됨 구분을 검증했다. 실제 iOS가 아닌 격리 Chromium/VM 검사다.
- 독립 리뷰에서 190px Today 메뉴의 긴 안내가 짧은 화면을 넘는 문제를 발견했다. 기존 nav에 화면 높이 제한+내부 스크롤만 추가했고393×568/844×390의 마지막 메뉴 링크 접근1/1 PASS. Live는 기존 스크롤을 재사용한다.
- 보조 Codex `nh127_push_review`가 Apple 공식 VAPID 조항을 Native APNs와 혼동하지 않았음을 재검토한 뒤 전송2파일만 구현했다. 기존 코드 RED→동일origin1시간 재사용/경계갱신/다른키·발신자·origin 분리/암호화복호화·서명·만료 검증 GREEN. 관련19/19 PASS. Root가 구현을 직접 대조했다. `live_sticky_review`는 UI 독립 검토와 짧은 메뉴 접근 반례를 맡았다. NH127의 실제 Orca Fable/Grok 조사와 이번 보조 검토를 혼동하지 않는다.
- SW148와 push-client 버전주소를 함께 변경해 기존 캐시를 갱신한다. 별도 불변 공지 `2026-09-07-iphone-notifications`를 추가했다. 실제 고객 시험 푸시/Apple 구독 생성은 실행하지 않았다.

## 운영 영수증

- 제품 `15412505614ba35a8c419ad14eaa16332533f938`: 08:51:09 KST 자동 배포·08:51:29 preflight OK. 최종 공용 클라이언트/전송/인라인34/34 PASS·독립 UI GO 회수. 기존 정본 및 오늘판/Live 알림 스케줄은 그대로다.
- 08:52 공개 Today/Live 양쪽 설치 metadata·393px 아이폰 모사 안내/클릭 후 설명 유지·버튼텍스트 보존·가로넘침0·JS오류0·시험구독0 PASS. 기존 manifest standalone/start_url /live 유지, SW148/helper 새 URL 일치 확인. 실제 iPhone의 설치/알림권한 UI를 조작한 검사가 아니다.
- 새 공지1회·재접속/Live 중복0·소개14개 PASS. `/tmp/nh128-public-proof.json`, `/tmp/nh128-public-notice-proof.json`, `/tmp/nh128-deploy.txt` 및 `/tmp/nh128-today.png`, `/tmp/nh128-live.png` 시각 확인. 실제 기기 수신 성공은 아직 주장하지 않는다.

## WRC 보고

- 작업 시작 전 확인한 MD — 자동 주입: 사용자 AGENTS·메모리 요약·Ponytail Full. 직접 읽음: 이번 세션 공유 START_HERE·CANONICAL13원칙/§11.1·WIKI_RULES·ENFORCEMENT·PMO_LIVE_BOARD·REPORT_READ_INDEX 및 이번 턴 관련 머리 재확인, README·NH127 보고, 기존 wrc-start/orca-cli/orchestration 지침. 미읽음/불가: 실제 iPhone 기기·사용자의 설치 상태 답변. 이번 작업 전용 파일: push-client/Today/Live/manifest/SW/push 전송·해당 집중검사·Apple 공식문서.
- 적용한 규칙: 기존 수리·배포 승인,13원칙 전체,코드 전 Corridor,공통함수 재사용,개인브라우저 격리,독립검토,실기기와 모사 증거 구분.
- First Principles 게이트: PASS.
- 개발현황 반영: 대상 안정 ID NOWHOT-IPHONE-PUSH-001, 변경 레코드 DEVCHG-NOWHOT-20260907-215. 최종 제품1541250·운영preflight·공개바이트/안내를 대조해 일치 확인. 실제 iPhone 수신은 미확인으로 유지한다.
- 금지선 준수: 구독 동의·기존 앱 identity·과거 판본 보존. 자동 권한 요청/실고객 시험 푸시/신규 서비스·의존성/메모리 쓰기0.
- David 행동 필요 여부: 아이폰 홈 화면의 지금핫 실행 후 알림 허용이 기기에서 필요하다. 이미 그렇게 쓰고 있다면 설치/권한/수신 결과 확인이 남는다.
- Telegram 알림 필요 여부: 없음, 이 대화에서 보고.
- 이익 우선·과잉방어 점검: GO. 기존 웹앱/푸시를 보완하며 별도 네이티브 앱이나 추가 전송 서비스를 만들지 않는다.
- 하지 않은 일: 실제 아이폰 알림 표시 성공 주장·사용자 대신 권한 허용·실제 고객 시험 발송·전체 test·광고/자체 기사 작업.
