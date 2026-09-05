# NH120 Grok review — minimal suggestion intake

Status: READ-ONLY review. No product edits, public POST, or deploy by this worker.
Local HEAD: `b2976be` plus Root’s uncommitted intake (this worker did not author it).
Scope: `store.addServiceFeedback`, `POST /api/feedback`, `GET /api/admin/feedback`, `feedback.html`, Today/Live menu, admin list.
Out of scope: ranking, ads, editorial pipeline, a broad store/auth audit.

## Verdict for Root

**GO.** No concrete security or correctness blockers on the dirty tree.

The intake reuses `ownerOf` / session+device, global `readBody` 1e6 cap, immediate `_persist` with in-memory pop on write failure, UUID-v4 `requestId` dedupe per user, kind allowlist, message 5..2000, receipt `{ok,id,createdAt}` only, admin `esc()` list under `isAdmin`. It does not insert into the public feed.

First Principles 게이트: PASS.

## What was reviewed

Existing patterns first, then the dirty diff:

| Gate | Existing pattern | This intake |
| --- | --- | --- |
| AuthZ | `ownerOf`: login session > device key (`nh_k`) + `nh_cid` first-bind | Same `denied(body.userId)`, plus cookie presence before `readBody` |
| CSRF | `SameSite=Lax` on session/device/key | Route-local `Origin` vs `originOf` and `sec-fetch-site !== cross-site` (not a global fence; stricter than `/api/comment`) |
| Body | `readBody` rejects > 1e6 then `JSON.parse` | Reused; non-JSON Content-Type → 415; arrays/`null` rejected |
| Persist | `createPost`/`addComment` push then `_persist()` with **no** rollback | Push, `_persist`, `pop()` on throw; 503 and no receipt |
| Admin XSS | `admin.html` `esc()` on posts/comments | Same `esc()` on kind/message/id/userId/build; `textContent` on the public form |
| Feed | `createPost`/`addSubmission` call `engine.invalidate()` | Not called; not in `posts`/`submissions`/`mySpace` |

Focused tests in the dirty tree (`test/service-feedback.test.js`) passed here: store rollback/dedupe/5-per-24h and local API origin/owner/receipt/admin (2/2). Playwright client retry was skipped in this environment (no Chromium); the test file covers it when Playwright is present.

No production `POST https://nowhot.kr/api/feedback`.

## Corridor (this path only)

Guardrails: Node application security, OWASP Top 10 (injection, XSS, CSRF, broken access control, sensitive data). Supply-chain of the whole repo was not re-audited.

| Severity | Count |
| --- | ---: |
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 (residuals below, not findings) |

Checks that fired and were **already closed** in the diff:

- **CWE-79 XSS** — public page uses `textContent`; admin interpolates only through `esc()`. Payload `<img src=x onerror=alert(1)>` is stored raw and must not become an `img` in the admin panel (asserted in the API test).
- **CWE-352 CSRF** — cookies are `SameSite=Lax`; POST also rejects `sec-fetch-site: cross-site` and mismatched `Origin`. Cross-site form POST is 415 (`application/json` required).
- **CWE-862/863** — write requires `ownerOf`; other-user cookie + victim `userId` → 403; admin GET is inside the existing `isAdmin` block; `GET /api/feedback` is 404.
- **CWE-20** — kind ∈ {suggestion,bug,other}; message trim 5..2000; `requestId` must be UUID v4; extra body keys are not spread into the record. Server `build` is `buildId()`, not client-controlled.
- **CWE-770** — 5 / rolling 24h / user after successful persist; idempotent retry at the cap does not consume another slot.

## Residuals (not blockers)

These do not violate the stated contract.

1. **No new IP limiter.** `/api/session` is already 60/min/IP. Feedback adds at most five 2k-char rows per minted user per day. Same class as comments/posts. Do not invent a second quota unless the store file itself becomes the incident.
2. **`originOf` does not split `x-forwarded-proto`.** `isSecureRequest` takes the first comma token; `originOf` does not. Caddy on this repo sets a single scheme, so production Origin should match. If a proxy ever sends a list, this route would 403 every real browser.
3. **Cookie-blocked retry.** After `/api/session` the client keeps `userId` and will not re-session on a later cookie-gate 403. Normal browsers store `Set-Cookie` before the next `fetch`. In-app WebViews that drop cookies already cannot bind accounts.
4. **Admin is list-only.** No delete/workflow. Privacy copy says deletion is on request (existing email path). Do not add a workflow engine in this slice.
5. **Playwright path not executed in this worker.** Store + local API tests are green.

## Must stay true at ship

- Receipt only after a successful persist; failed write pops memory and returns 503 without `id`.
- Retry with the same `requestId`+kind+message returns the same `id` and does not double-count the daily cap.
- Public JSON never includes `message`, `userId`, or `requestId`.
- Admin HTML never assigns `innerHTML` from unescaped `message`.
- No `engine.invalidate()`, no sitemap `/feedback` (page is `noindex`).
