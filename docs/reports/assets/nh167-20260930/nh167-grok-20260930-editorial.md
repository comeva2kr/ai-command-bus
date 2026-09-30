# NH167 editorial review — final guard verdict

Grok 4.7. Requested grok-4.7-xhigh was not confirmed by a provider acknowledgment.

**Verdict: PASS on the changed cross-slot guard.** This is not a deploy approval. Analytics stays the earlier PASS.

Frozen patch `/tmp/nh167-editorial-20260930-final.patch` sha256 `c2b2893ef5e6c136fc07eb363b5df25115add8252d2ee60e08d5287afc38af86`. Manifest lists 26 paths. Worktree `tools/build-slot-canonical-edition.mjs` and `test/slot-canonical-prepublish.test.js` match that manifest (`81275b5d…`, `73e09b1b…`). Guard tap: red failed the first-grant case (`1억5천만원` actual false), green is 22 pass / 0 fail including that test. Final lunch replay withheld 6 and kept 0 material updates. Final evening replay withheld 5 and kept 2.

`headlineQuantities` reads the original title first. It keeps a unit-bearing amount or count (`억`, `원`, `달러`, `명`, `가구`, `관왕`, `%`, `배`, `개` when not `개월`, and `N dead`). A new token is material even when the earlier headline had no quantity. Tenure (`9개월`), a bare year (`2026년`), and a bare model number do not enter the set. A shared year cannot take the strong-quantity shortcut, because a year is not a quantity. The shortcut is a quantity whose `parseFloat` is at least 100, plus at least 3 shared tokens.

## Root counterpoints

Accepted:

- LAFC `9개월 동행 끝` is the same dismissal, not a new count. Evening replay withholds it against `손흥민 소속팀 LAFC, 도스 산토스 감독 경질⋯새 사령탑 물색`, basis `no_demonstrated_fact_change`, `entity_share:0.67`. The unit test expects `LAFC 감독 경질` → `…9개월 동행 끝` to be non-material.
- Nike Ghostface and waterproof Air Force stay different stories. Lunch withhold list has no Nike row. The guard test expects `2026년` plus the two original titles to be `same: false`. The trailing `1` is not a quantity, so it cannot glue them.
- DMZ 진술 and the 여야 조사/탄핵 lines are not in the evening withhold list. Share on those headlines is under 0.6, so they stay in the edition as their own items.
- A first grant stays. `우즈 원폭 영화 출연 고사` → `…국고지원금 1억5천만원 받는다` is material. That is the red-tap failure the green tap now passes. `사망 3명` → `5명`, and `3 dead` → `5 dead`, stay material. The same count in Korean and English is not material. `사망 3명` plus `가동 9개월 만` is not material.
- A common year is not an update and not a strong-quantity shortcut. `2026년 공장 화재 사망 3명` against `사망 3명` is non-material.

Rejected:

- The earlier Gunsan measurement used truncated titles and dropped `수주`. That pair is not the fixture. The evening replay withholds `8700억 군산 AI데이터센터 … 현대ENG 수주…내달 착공` against `현대엔지니어링, 8700억 군산 AI 데이터센터 수주`, basis `no_demonstrated_fact_change`, `entity_share:0.60+quantity`.

## Residual semantic risk

Not a failing test. Evening kept `10월, 50개 단지 3만8032가구 분양 예정` as `changed_headline_number` `["50개","3만8032가구"]` against `10월 수도권 2만4600가구 분양…`, at `entity_share:0.60`. Those are different supply figures occupying one story slot. `$99` and `99달러` are different tokens, so a symbol price and the same price in 달러 can look like a changed amount. `parseFloat("1억5천만원")` is 1, so that grant cannot take the strong-quantity shortcut; `8700억` can, and the real Gunsan row does.
