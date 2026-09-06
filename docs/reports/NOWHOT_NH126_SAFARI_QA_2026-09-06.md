# NH126 Safari 계열 보완 검증 — 2026-09-06

판정: **격리 macOS WebKit 검사 PASS, 실제 iPhone Safari 미확인**. 제품 파일 수정·배포 없음. 공개 nowhot.kr를 10:32 KST에 읽고 실제 스크린샷을 열람했다.

- 기기/도구: USB 트리에 iPhone/iPad 없음. Xcode 경로의 xctrace가 Mac만 출력한 뒤 끝나지 않아 자체 명령을 종료했다(전체 무선 기기 목록 확인으로 주장하지 않음). Simulator 구성은 있으나 설치된 런타임 증거 없음. Playwright WebKit 미설치. Safari 26.5.2의 WebDriver는 원격 자동화 미허용으로 세션 생성 거부; 설정을 바꾸지 않았다.
- 실행 엔진: 시스템 **WKWebView / WebKit 21624.2.5.11.8**, 독립 창·`WKWebsiteDataStore.nonPersistent()`, 393×852 포인트. Safari.app이나 iPhone이 아니다. macOS 스크롤바 때문에 콘텐츠 폭은376px이며 모바일 터치/주소창/안전영역은 재현하지 않는다.
- Today: 모닝 기사56·쿠팡6. 아래1400px/위400px 스크롤 모두 관심분야 top59px = 헤더 bottom59px, 가로 넘침0. 광고와 기사 제목 왼쪽58px·폭302px·글꼴21px·굵기880·줄높이28.98px 일치, 광고 제목 공백 없음·제휴 고지 표시.
- Live: 핫 상태 아래1500px/위600px 스크롤 모두 정렬바 top59px = 헤더 bottom59px, 가로 넘침0. 최신 전환 뒤 카드10개 실제 로딩·선택 상태 확인. Today/Live 수집 JS 오류0. 광고 링크 클릭·계정/믹스 저장 요청 없음.
- 실행상 보완: 첫 임시 probe는 Swift MainActor 초기화 오류로 실행되지 않았고, 수정 후 실행했다. 첫 최신 스크린샷은 로딩 중이어서 카드 로딩 대기를 추가해 재검사했다. 최종 JSON·PNG는 재검사 결과다. 이는 제품 결함이 아니다.

증거:

- `/tmp/nh126-safari-availability.txt`: 실제 도구/기기 가용성 및 SafariDriver 거부 응답.
- `/tmp/nh126-safari-proof.json`, `/tmp/nh126-safari-run.log`: 최종 PASS·좌표·서식·개수·엔진.
- `/tmp/nh126-safari-qa.swift`: 재실행 가능한 임시 probe(`swift /tmp/nh126-safari-qa.swift`).
- `/tmp/nh126-safari-today-down.png`, `/tmp/nh126-safari-today-ad.png`, `/tmp/nh126-safari-live-down.png`, `/tmp/nh126-safari-live-latest.png`.

실기기 잔여: iPhone Safari에서 손가락 스크롤·주소창 접힘/펼침·안전영역·실기기 글꼴/화면폭으로 관심분야/정렬바와 광고를 확인해야 한다. 본 결과를 실기기 PASS로 승격하지 않는다.

작업 규칙:

- 작업 시작 전 확인한 MD: 자동 주입 AGENTS/WRC·Ponytail Full·부모 문맥; 직접 읽음 NH123/NH124 보고와 개발현황 관련 범위; 공용 WRC 6문서는 부모가 직접 읽은 컨텍스트를 승계; 미읽음/불가 실제 iPhone; 이번 전용 파일은 위 probe·증거·보고.
- 적용한 규칙: 사용자 1·2 진행 승인 범위의 읽기/검증, Corridor 사전 분석, 기존 NH124 선택자 재사용, 개인 브라우저 격리, 증거 단계 구분.
- First Principles 게이트: PASS. 실제 iPhone 미확인 한계를 표시한 검증 보고다.
- 개발현황 반영: 대상 안정 ID `NOWHOT-POSTRELEASE-VALIDATION-001`; 변경 레코드는 부모 NH126 통합 기록에 연결할 보조 검사; 기존 Chrome 증거에 macOS WebKit만 추가, 실기기 완료는 추가하지 않음.
- 금지선 준수: 설치/자동화 설정 활성화/개인 Safari 탭/광고 클릭/배포/제품 수정0.
- David 행동 필요 여부: 향후 실제 iPhone 결과가 필요하지만 이 검사에서 반복 질문하지 않음.
- Telegram 알림 필요 여부: 없음, 부모 통합 보고로 전달.
- 이익 우선·과잉방어 점검: GO, 설치 없이 이미 있는 시스템 엔진으로 가능한 검사를 끝냈다.
- 하지 않은 일: 실제 iPhone 검사, 전체 화면/모든 광고 검수, 심사 신청, 메모리 쓰기.
