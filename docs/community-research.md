# 한국 커뮤니티 규모 리서치 (2026-07-23)

> 소스 후보 선정용. 수치는 Similarweb 무료 페이지(최근 3개월 총 방문 → 월평균 환산) 1차 확인. 순수 MAU 아님(재방문 포함). RSS 수집 가능 여부는 `docs/handoff.md`의 소스 검증 결과와 교차할 것. 콘텐츠 선별 원칙: **대표 베스트게시판만** (handoff.md 절대 원칙 4).

## 수집 후보 순위 (월평균 방문)

| 순위 | 커뮤니티 | 도메인 | 월평균 방문 | 성격 | 대표 베스트게시판 |
|---|---|---|---|---|---|
| 1 | 디시인사이드 | dcinside.com | ~96.5M (KR #4) | 남초 종합 | 실시간 베스트 |
| 2 | 에펨코리아 | fmkorea.com | ~50.3M | 남초 유머/시사 | 포텐 터짐 |
| 3 | 더쿠 | theqoo.net | ~21.9M | 여초 연예 | 핫게시판 |
| 4 | 아카라이브 | arca.live | ~19.2M | 게임/서브컬처 | 베스트 라이브 |
| 5 | 루리웹 | ruliweb.com | ~17.3M | 게임 | 오늘의 베스트 |
| 6 | 인벤 | inven.co.kr | ~16.0M | 게임 | 인벤 베스트 |
| 7 | 뽐뿌 | ppomppu.co.kr | ~15.5M | 핫딜/쇼핑 | 뽐뿌게시판 |
| 8* | 엠엘비파크 | mlbpark.donga.com | 표기 48.4M — 단위 재검증 필요 | 야구/종합 | 자유게시판 |
| 9 | 네이트판 | pann.nate.com | ~9.9M | 여초 이슈 | 톡커들의 선택 |
| 10 | 클리앙 | clien.net | ~9.6M | IT 종합 | 모두의공원 (c_hot50 수집 중 ✅) |
| 11 | 일베저장소 | ilbe.com | ~9M | 정치색 강함 — 브랜드 리스크 별도 판단 | 일베스트 |
| 12 | 인스티즈 | instiz.net | ~4.9M | 여초 연예 | 이슈/톡 |
| 13 | 보배드림 | bobaedream.co.kr | ~4.5M | 자동차 | 자동차 이야기/유머 |
| 14 | 이토랜드 | etoland.co.kr | ~3.6M | 종합 유머 | 유머게시판 |
| 15 | 웃긴대학 | humoruniv.com | ~3.1M | 유머 | 베스트게시판 |
| 16 | 82쿡 | 82cook.com | ~3.0M | 여초 생활 | 자유게시판 |
| 17 | SLR클럽 | slrclub.com | ~2.9M | 사진/종합 | 자유게시판 |
| 18 | 오늘의유머 | todayhumor.co.kr | ~0.9M (쇠락) | 유머 | 베오베 |
| - | 개드립·가생이·다모앙 | - | 1차 출처 미확보 | - | - |

## 수집 불가 (앱/폐쇄형)

블라인드(앱+직장인증, 2025.2Q MAU ~200만), 에브리타임(앱+대학인증), 네이버카페 폐쇄형(여성시대 등), 카톡 오픈채팅.

## 수집 가능성 교차 (1차 검증 결과 반영)

- **robots/Cloudflare 차단 확정**: fmkorea, arca.live, gasengi, slrclub, damoang, reddit, todayhumor(RSS 부재)
- **공식 RSS 확인/즉시 가능**: clien(운영 중), hackernews(front_page), 딴지뉴스(ddanziNews RSS — 뉴스 성격)
- **2차 검증 중**: ppomppu, ruliweb, inven, dcinside, theqoo, instiz, mlbpark, humoruniv, bobae, 82cook
- **gnews 8종**: robots상 /rss 비허용 지적 있으나 구글 공식 RSS 기능으로 판단해 WARN 유지 — 변호사 검토 목록에 포함

출처: Similarweb 각 사이트 페이지, 블라인드 광고소개서(2025.2Q), 머니투데이/유니콘팩토리(에브리타임), 플래텀(디시 매출). 교차검증 참고: waffleboard.io/ranking, tali.kr(2차 가공이라 채택 안 함).
