# NOWHOT-MARKET-POLICY-SOURCE-SAMPLE-001

- 상태: `COMPLETE WITH LIMITS`
- 단계: `B1.5-E1-0B`
- 환경: local only
- 변경 ID: `DEVCHG-NOWHOT-20260810-009`
- 범위: 시장·정책 첫 카테고리 증거 팩
- 비용 영수증: 신규 키 0, 신규 수집기 0, LLM 호출 0

## 판정

기존 레지스트리 어댑터만으로 거시경제·정책·기업·시장 네 데스크의 양질 보도
20건을 각 5건씩 구성했고, 중요 주장 5건을 공개 공식 자료와 대조했다. 공식 확인은
3건 일치, 2건 부분 일치다. 공급과 선택적 검증 라우팅의 표본은 증명됐지만 E1
층화·규모·manifest, 레지스트리 메타데이터, 다른 카테고리 품질과 운영 준비는
증명하지 않았다.

## 재현 스냅샷

| 항목 | 값 |
|---|---:|
| 저장 시각 | `2026-08-10T10:41:04.955Z` |
| SHA-256 | `269523e7cf8954e32dbbf81015e521f4651ce772035c5efa06ba5c1051d55369` |
| 전체 행 | 5,290 |
| 정규화 고유 URL | 3,278 |
| 중복 행 | 2,012 |
| 소스 | 76 |

접근 방식은 `existing_registry_adapter`, 보존 범위는 `metadata_and_link_only`, 중복
제거 키는 `normalized_url`이다. 기사 전문은 저장하지 않았다. `ownershipGroup`은
법적 소유권 확정값이 아니라 같은 매체 계열을 독립 출처로 중복 계산하지 않기 위한
보수적 운영 그룹이다. 원취재·전재를 URL만으로 확정할 수 없어 20건 모두
`syndicationStatus: unknown`을 유지했다.

## 양질 보도 20건

| ID | 데스크 | 매체·운영 그룹 | 발행 시각 | 보도 |
|---|---|---|---|---|
| MP-R01 | 거시경제 | 이투데이 · etoday | 2026-08-10T09:13:00Z | [고용보험 가입자 증가 폭 29개월 만에 최대](https://www.etoday.co.kr/news/view/2612703) |
| MP-R02 | 거시경제 | 매일경제 · maekyung | 2026-08-10T08:56:38Z | [대출금리 양극화…대기업·중기 격차 최대](https://www.mk.co.kr/news/economy/12123159) |
| MP-R03 | 거시경제 | 한국경제 · hankyung | 2026-08-10T10:00:05Z | [자영업 코너 몰리고, 건설은 침체…트럭 '내수 빙하기'](https://www.hankyung.com/article/2026081050611) |
| MP-R04 | 거시경제 | 헤럴드경제 · herald | 2026-08-10T05:04:15Z | [日, 상반기 역대 최대 경상수지 흑자…가계 소비는 ‘꽁꽁’](https://biz.heraldcorp.com/article/10836088) |
| MP-R05 | 거시경제 | 한국경제 · hankyung | 2026-08-10T03:46:04Z | [美 국채금리 20년래 고점…AI투자·주택시장 압박](https://www.hankyung.com/article/202608103646i) |
| MP-R06 | 정책·정치 | 연합뉴스 · yonhap | 2026-08-10T10:28:37Z | [정부, 피지컬 AI 구매 대폭 확대…로봇 생태계 키운다](https://www.yna.co.kr/view/AKR20260810145500003) |
| MP-R07 | 정책·정치 | 연합뉴스 · yonhap | 2026-08-10T09:58:55Z | [“도금강판 반덤핑관세 과도”…포스코, 일본 정부에 반박의견서](https://www.yna.co.kr/view/AKR20260810143000003) |
| MP-R08 | 정책·정치 | 이투데이 · etoday | 2026-08-10T09:56:00Z | [靑 “메가특구특별법 연내 제정…충청 246조·영남 107조 투자도 올해 시작”](https://www.etoday.co.kr/news/view/2612932) |
| MP-R09 | 정책·정치 | 조선비즈 · chosun | 2026-08-10T09:44:42Z | [정부, 1兆 규모 서남권 반도체 용수 사업 예타 면제 추진](https://biz.chosun.com/policy/policy_sub/2026/08/10/CLQQCZDX4VAKLEY2OOIVR2LE5I/) |
| MP-R10 | 정책·정치 | 조선비즈 · chosun | 2026-08-10T07:39:28Z | [한일 정부 ‘조선 담당 과장급 회의’ 7년 만에 부활 추진](https://biz.chosun.com/policy/policy_sub/2026/08/10/FU3QXJAXUNE7PENIOXJLCJEQWM/) |
| MP-R11 | 기업·산업 | 머니투데이 · moneytoday | 2026-08-10T10:26:57Z | [대만 TSMC, 7월 매출 45%↑…사상 최대 또 경신](https://www.mt.co.kr/world/2026/08/10/2026081019074393500) |
| MP-R12 | 기업·산업 | 매일경제 · maekyung | 2026-08-10T10:18:27Z | [LX세미콘, 차량용 MCU 양산 … 현대차·기아에 공급 시작](https://www.mk.co.kr/news/business/12123205) |
| MP-R13 | 기업·산업 | 연합뉴스 · yonhap | 2026-08-10T09:20:45Z | [한샘, 2분기 영업이익 5배로 증가…13분기 연속 흑자(종합)](https://www.yna.co.kr/view/AKR20260810138551527) |
| MP-R14 | 기업·산업 | 매일경제 · maekyung | 2026-08-10T07:47:13Z | [한화, KAI 지분 15.89% 확보…공정위에 기업결합심사 신청 예정](https://www.mk.co.kr/news/business/12122975) |
| MP-R15 | 기업·산업 | 조선비즈 · chosun | 2026-08-10T09:05:20Z | [포도봉봉 해태htb 인수전 흥행… 커피 프랜차이즈 대 신생 PE ‘2파전’](https://biz.chosun.com/stock/stock_general/2026/08/10/TROK7O5LJRBWJJKLCLR3B2OMK4/) |
| MP-R16 | 시장 | 연합뉴스 · yonhap | 2026-08-10T07:45:51Z | [국고채 금리 일제히 상승…3년물 연 3.778%](https://www.yna.co.kr/view/AKR20260810124100008) |
| MP-R17 | 시장 | 연합뉴스 · yonhap | 2026-08-10T07:36:08Z | [코스피 주춤, 코스닥만 날았다…레버리지 규제 이후 수급 개선](https://www.yna.co.kr/view/AKR20260810082800008) |
| MP-R18 | 시장 | 이투데이 · etoday | 2026-08-10T08:07:00Z | [\[채권마감\] 사흘째 약세, 최근 강세장 되돌림+일본 긴축 우려](https://www.etoday.co.kr/news/view/2612907) |
| MP-R19 | 시장 | 머니투데이 · moneytoday | 2026-08-10T07:38:11Z | [美 금리인상 부담 완화에 기술주 강세…닛케이, 2.08%↑ \[Asia마감\]](https://www.mt.co.kr/world/2026/08/10/2026081016205637455) |
| MP-R20 | 시장 | 연합뉴스 · yonhap | 2026-08-10T09:21:33Z | [반도체업체 CXMT, MSCI지수 편입…中본토 시총 1위 굳히기](https://www.yna.co.kr/view/AKR20260810139200089) |

MP-R15는 같은 정규화 URL이 풀에서 `chosunbiz`, `chosunbiz-stock` 두 행으로 발견됐다.
표본에서는 한 건으로 계산했다.

## 선택적 공식 확인 5건

| 검수 | 대상 | 트리거 | 판정 | 공식 근거 | 확인 결과와 한계 |
|---|---|---|---|---|---|
| MP-A01 | MP-R04 | 공식 통계 | 일치 | [일본 재무성·일본은행 국제수지 속보](https://www.mof.go.jp/policy/international_policy/reference/balance_of_payments/preliminary/bpch2026.pdf) | 상반기 경상수지 17조4292억엔, 전년 동기 대비 22.5% 증가는 확인. 역대 최대·가계 소비 설명은 이 자료만으로 미확정. |
| MP-A02 | MP-R08 | 정책·법안 | 일치 | [정부 부처 합동 메가특구 보도자료](https://www.me.go.kr/home/web/newsRead.do?boardId=1857510&boardMasterId=939&menuId=10607) | 특별법 2026년 내 제정 계획은 확인. 충청 246조원·영남 107조원 투자 착수는 미확정. |
| MP-A03 | MP-R11 | 기업 수치 | 일치 | [TSMC 월간 매출](https://investor.tsmc.com/english/monthly-revenue/2026) | 7월 매출 4675억8000만 대만달러, 전년 대비 44.7% 증가 확인. 미감사 월간 수치이며 45%는 반올림. |
| MP-A04 | MP-R14 | 소유 구조 | 부분 일치 | [KIND 취득 결정](https://kind.krx.co.kr/external/2026/07/08/000721/20260630002959/61381.htm) · [KIND 대량보유](https://kind.krx.co.kr/external/2026/07/01/000086/20260701000099/00636.htm) | 312만1098주·5000억원 취득 결정, 취득 후 4.73%, 별도 11.21%는 확인. 15.89% 합산과 기업결합심사 예정은 직접 미확정. |
| MP-A05 | MP-R06 | 정책 범위 | 부분 일치 | [정책브리핑·과기정통부](https://www.korea.kr/news/policyNewsView.do?newsId=148968284) | 피지컬 AI 메가프로젝트와 생태계 지원 방향은 확인. 로봇 구매 대폭 확대 조치는 미확정. |

## 확인된 한계

1. 기존 풀 5,290행 중 정규화 고유 URL은 3,278개다. E1 입력 전 URL 중복 제거가 필수다.
2. 매체 URL만으로 원취재·전재 관계를 확정할 수 없다.
3. 공식 확인은 기사 전체의 진실 판정이 아니라 선택한 중요 주장에 대한 대조다.
4. 현 레지스트리에는 `sourceRole`, `marketPolicyDesk`, `ownershipGroup` 필드가 아직 없다.
5. 이 표본은 다른 카테고리 정책 팩과 운영 런타임을 증명하지 않는다.

## 다음 허용

`B1.5-E1-0C`: 정규화 URL 중복 제거, 역할·데스크·계보 메타데이터 fixture,
E1 층화·규모·manifest와 증거 영수증 계약을 고정한다. 새 키 발급, LLM 라벨링,
제품 구현, push와 운영 배포는 계속 금지한다.

## 후속 상태 · DEVCHG-NOWHOT-20260810-010

`B1.5-E1-0C`의 기계 계약은 `NOWHOT-EDITION-CANDIDATE-CONTRACT-001`로 구현됐다.
기존 수집 풀의 상위 편집 재료를 정규화 URL로 중복 제거해 최대 100건까지 재현하고,
역할·운영 그룹·카테고리·관측 신호를 영수증으로 남긴다. 사람 두 명의 블라인드
포함·제외와 클러스터 정답표는 아직 없으므로 E1 사람 검수 PASS가 아니다.

David 승인 범위는 기존 제품의 로컬 가역적 오늘판 후보까지이며, 신규 키·LLM
라벨링·push·운영 배포는 수행하지 않았다.

## 정정 · DEVCHG-NOWHOT-20260810-011

010 후속 상태에서 100건을 런타임 계약처럼 표현한 부분을 철회한다. 실제 오늘판
후보는 선택 카테고리 수, 유효 공급, 이슈 예산에 따라 동적으로 정해지며 고정 건수
도달은 제품 품질이나 릴리스 게이트가 아니다.

## 재정정 · DEVCHG-NOWHOT-20260811-019

E1 자체의 크기도 100건으로 미리 정하지 않는다. 분야·근거 유형·출처 역할·변화
상태를 층화하고 파일럿의 불일치율, 목표 정밀도와 검수 예산을 확인한 뒤 규모와
manifest를 함께 동결한다.
