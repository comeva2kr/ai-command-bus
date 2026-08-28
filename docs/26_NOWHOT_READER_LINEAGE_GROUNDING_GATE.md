# NOWHOT-B6-READER-LINEAGE-GROUNDING-REPAIR-001

## 판정

- 변경 ID: `DEVCHG-NOWHOT-20260811-058`
- 환경: 로컬 복제본만
- 상태: `local_repair_pass_with_limits`
- 결론: `paragraph`와 독자 7필드의 사후 변조, 구조화 근거 없는 `whyImportant`와 `change`가 현재 계약에서 모두 HOLD 된다.
- 운영 승격: BLOCK 유지

## 수리 전

| 반례 | 수리 전 결과 | 원인 |
|---|---|---|
| `whatHappened`를 둔 채 `paragraph`만 변조 | `lineage_pass` | 두 필드를 하나의 대체값처럼 해시 |
| 근거 계보 없는 임의 중요성·변화 문장 | `reader_copy_pass` | 길이와 표면 앵커만 확인 |
| 독자 7필드 중 하나를 사후 변경 | 필드별 근거 결속 없음 | 검수 패킷에 문장은 있었지만 현재 근거와의 독립 지문이 없음 |

RED 회귀는 `11/14 PASS · 3 FAIL`로 세 결함을 직접 재현했다.

## 현재 계약

1. `NOWHOT-EDITORIAL-LINEAGE-CONTRACT-001` v3, fingerprint v4
   - `paragraph`와 `whatHappened`를 별도 claim으로 저장한다.
   - 제목, 리드, 사건 설명, 중요성, 현재 열기, 선택 이유, 후속 확인을 현재 문장으로 다시 해시한다.

2. `NOWHOT-EDITORIAL-READER-COPY-CONTRACT-001` v7, fingerprint v1
   - `headline`, `summary`, `whyImportant`, `whyNow`, `change`, `watchNext`, `confidenceLabel` 일곱 필드를 모두 SHA-256 지문에 넣는다.
   - 지문은 정본 `evidenceHash`, `claimLineage.contentHash`, 필드별 근거 방식, 구조화 변화 근거를 함께 포함한다.
   - 제공된 문장은 현재 근거에서 결정론적으로 다시 만든 문장과 필드별로 일치해야 한다.

3. `NOWHOT-BLIND-REVIEW-PACKET-001` packet v4
   - `readerLineage`와 필드별 결속 판정을 패킷 ID에 포함한다.
   - 문장이 같아도 근거·계약·변화 근거가 바뀌면 이전 판정을 재사용하지 않는다.

## 중요성·변화 근거

`왜 중요한가`는 다음 셋 중 하나만 허용한다.

- 근거 ID와 독립 verifier 기록이 있는 검증 편집
- 현재 사건어에서 선택된 결정론적 사건 프레임
- 현재 claim lineage에 기록된 편집 정책과 영향 렌즈

`새로 달라진 점`은 `changeState`, `reasons`, `deltas`, `newSources`, 이전 판 매칭 정보로 문장을 다시 만들 수 있어야 한다. 임의 문자열만 있거나 구조화 근거와 문장이 다르면 `changeEvidenceGrounded` HOLD다.

## GREEN 증거

- 핵심 회귀: `14/14 PASS`
- 통합 회귀: `47/47 PASS`
- 전체 회귀: `1,117/1,117 PASS`
- `paragraph` 단독 변조: HOLD
- 독자 7필드 개별 변조: `7/7 HOLD`
- 근거 없는 중요성·변화: HOLD
- 외부 LLM 호출: 0

## 바뀐 모습

독자 화면의 문구 자체는 기자식 보도 문체를 유지한다. 화면 뒤 검수 패킷에는 각 행마다 현재 독자 지문과 필드별 결속 결과가 붙는다. 누군가 문장만 고치거나 오래된 검수 결과를 붙이면 정확 응답 서빙 게이트가 그 판을 제공하지 않는다.

## 남은 HOLD

- 같은 사건을 다른 사건으로 나누거나 다른 사건을 하나로 합치는 연속성 오탐·미탐
- 관련기사 제목의 키워드가 주 사건의 중요성·관전 프레임을 바꾸는 오염
- 다중 분야 이슈 한 건의 분야별 고유 사건 중복 충족
- 중간 신호 뒤 평가 삭제의 정확 원복과 실제 개인화 효용
- 실제 사람 편집 검수, 다일 안정성, 비용, 장애 복구

다음 한 단계는 `B6-EVENT-CONTINUITY-FRAME-REPAIR`다. 이번 영수증은 기사 사실성, 사람 문장 품질, 사건 매칭 정확도, 운영 배포 가능을 증명하지 않는다.
