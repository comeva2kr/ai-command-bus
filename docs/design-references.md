# 디자인 레퍼런스 DB — "AI 티 안 나게" (2026-08-01 수집)

David 지시: "깃허브에 AI로 만든 티 안나게 app/웹서비스 만드는 법 게시글 중 제일
반응 좋은 최신 글 몇 개 보고 앞으로 참고할 레퍼런스 DB화". 수집 기준은 실측
반응(HN 포인트·GitHub 스타 — API로 검증)이며, 미확인은 미확인으로 표기한다.
**지금핫의 모든 UI 작업 전에 이 문서의 체크리스트를 참조할 것.**

## 원천 자료 (반응 실측 순)

| # | 자료 | 반응(실측) | 핵심 |
|---|---|---|---|
| 1 | [Anthropic frontend-design Skill](https://github.com/anthropics/skills/tree/main/skills/frontend-design) | 저장소 165,346★ | AI 디자인은 3가지 룩으로 수렴(크림+세리프+테라코타 / 거의검정+비비드 악센트 / 무테두리 신문형) — 브리프 무관하게 나오면 재검토. 대담함은 시그니처 요소 1곳에 몰고 나머지는 절제 |
| 2 | [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) | 105,597★ | 실존 브랜드 70여 곳의 디자인 시스템을 DESIGN.md로 — "모던하게" 대신 브랜드명+토큰값으로 지시 |
| 3 | [Adrian Krebs — Show HN 1,590개 슬롭 정량 분석](https://www.adriankrebs.ch/blog/design-slop/) | HN 333pt/235댓글 | 16개 슬롭 패턴 정량화: 보라/인디고 CTA(10.7%), 전체 대문자 헤드라인, 01/02/03 장식 마커, 네비 이모지, glassmorphism, shadcn 기본 테마. 절반 이상이 AI 지문 보유 |
| 4 | [birobirobiro/awesome-shadcn-ui](https://github.com/birobirobiro/awesome-shadcn-ui) | 20,194★ | shadcn 기본값 탈출용 커스텀 테마/블록 모음 |
| 5 | [HN — New Yorker "A.I.-Design Aesthetic" 논의](https://news.ycombinator.com/item?id=48671684) | HN 25pt | 모노스페이스 숫자·이탤릭 세리프 제목·글로우가 대표 특징 |
| 6 | [freedesignmd — why shadcn looks generic](https://freedesignmd.com/blog/shadcn-looks-generic) | 미확인 | 기본 테마(slate 중성톤·Inter·8px radius) 방치가 문제 — CSS 변수 교체가 저비용 개성 |
| 7 | [prg.sh — Why Your AI Keeps Building the Same Purple Gradient Website](https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website) | 미확인 | LLM은 통계적 패턴 매처 — 네거티브 제약(금지 목록)+구체 레퍼런스로 분포를 바꿔라 |
| 8 | [Toss Tech — AI 시대, 디자이너를 없앴더니](https://toss.tech/article/removing_designers_in_ai_era) | 미확인(토스 기술블로그) | 반복 UI를 규칙/시스템 문서로 축적 — 매번 새로 프롬프트하지 말 것 |

## 지금핫 적용 체크리스트

작업 전 훑고, 어기면 근거를 남길 것.

### 아이콘·로고
- [x] 이모지를 아이콘 대체로 쓰지 않는다 → 2026-08-01 앱 아이콘·헤더를 플랫 스파이크 마크로 교체 완료
- [ ] 남은 이모지 UI 정리: 정렬 칩(🔥/🕒), 브리핑 카드(🕐/✖), 드로어 메뉴(📋/📊) — 텍스트 또는 미니 SVG로
- [x] 보라-파랑 그라데이션 로고 금지 (기존 그라데이션 나침반 아이콘 제거됨)

### 색·타이포
- [ ] 보라/인디고 CTA·그라데이션 금지 — 현 액센트(#4f8cff 블루)는 유지하되 코랄(#ff4b3e)을 브랜드 시그니처로 승격 검토
- [ ] 색 팔레트를 네임드 토큰 4~6개로 고정 문서화 (이 파일 하단에 추가할 것)
- [ ] "영구 다크모드+저대비" 패턴 자체점검 — 지금핫은 다크 단일 테마: 대비를 WCAG AA 이상으로 유지하는 조건부 허용
- [ ] border-radius 의도 선택 — 현 16px 카드: 유지 결정이면 그 이유를 남길 것

### 레이아웃·카피
- [ ] 전체 대문자 헤드라인 금지 / 01·02·03 장식 마커 금지
- [x] 캡슐 배지 남발 주의 — 근거 수치 배지(추천·댓글·교차보도)는 기능이므로 유지
- [ ] CTA는 행동 언어로 ("등록"→"댓글 남기기" 등 점검)
- [ ] 빈 상태 문구는 행동 유도로 (예: "아직 지금핫 댓글이 없어요 — 첫 의견을 남겨보세요")

### 마이크로인터랙션
- [ ] 애니메이션은 시그니처 모먼트 1곳(현: 상세 바텀시트 슬라이드)에 집중 — 산발 호버 이펙트 추가 금지
- [ ] prefers-reduced-motion 존중 (미구현 — TODO)
- [ ] 글로우 박스섀도 금지

### 프로세스
- [ ] UI 작업은 "토큰 정의 → 구현 → 스크린샷 자기비평(이게 브리프 무관 디폴트 룩인가?)" 순서로
- [ ] 실패한 디자인 결정도 이 문서에 기록해 반복 방지
