// 우리 데이터로 우리가 그리는 그림 (블루프린트 ②-2).
//
// 외부 차트 라이브러리를 쓰지 않는다. 이 프로젝트는 npm 의존성이 0이고,
// 무엇보다 **그림의 저작권이 100% 우리 것이어야** 공유 카드·SNS에 그대로 쓸 수
// 있다. 남의 데이터도 남의 코드도 들어가지 않은 그림이라 그렇다.
//
// 인라인 SVG로 낸다. 외부 요청이 없으니 차단기에도 안 걸리고, 다크/라이트는
// currentColor와 CSS 변수로 따라간다 — 그림 파일을 두 벌 만들 필요가 없다.

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// 가로 막대. 항목 이름이 한글이라 세로 막대보다 가로가 읽힌다.
//
// 값은 그대로 쓴다 — 축을 0이 아닌 곳에서 시작하면 차이가 과장된다.
// 데이터 시각화에서 가장 흔한 거짓말이고, 우리가 스스로에게 쓸 이유가 없다.
export function barsSvg({ rows = [], title = "", unit = "", width = 680 } = {}) {
  // 음수는 받지 않는다. 0에서 시작하는 가로 막대로는 음수를 정직하게 그릴 수
  // 없고, 지금 호출부에는 음수가 없다 — 나중에 재사용할 때 조용히 뭉개지는
  // 것보다 빠지는 편이 낫다(검수 2026-08-06 P2).
  const list = rows.filter((r) => r && Number.isFinite(Number(r.value)) && Number(r.value) >= 0);
  if (!list.length) return "";
  const rowH = 26;
  const padT = title ? 30 : 8;
  const padB = 8;
  const labelW = 150;
  const barW = width - labelW - 60;
  const max = Math.max(...list.map((r) => Number(r.value)));
  if (!(max > 0)) return "";
  const height = padT + list.length * rowH + padB;

  const bars = list.map((r, i) => {
    const v = Number(r.value);
    const w = Math.max(2, Math.round((v / max) * barW));
    const y = padT + i * rowH;
    return `<text x="${labelW - 8}" y="${y + 15}" text-anchor="end" class="ch-lb">${esc(r.label)}</text>` +
      `<rect x="${labelW}" y="${y + 4}" width="${w}" height="15" rx="2" class="ch-bar"></rect>` +
      `<text x="${labelW + w + 6}" y="${y + 15}" class="ch-val">${esc(v.toLocaleString("ko-KR"))}${esc(unit)}</text>`;
  }).join("");

  return `<figure class="chart"><svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img"
    aria-label="${esc(title || "막대 그래프")}" xmlns="http://www.w3.org/2000/svg">
    ${title ? `<text x="0" y="16" class="ch-ti">${esc(title)}</text>` : ""}
    ${bars}
  </svg></figure>`;
}

// 선 그래프 — 열기 눈금이 시간에 따라 어떻게 올랐는지.
//
// 레퍼런스: hnrankings.info가 게시물 순위 변화를 순수 시계열 그래프로만 보여
// 준다. 우리도 같은 것을 갖고 있는데 지금까지 화면 어디에도 안 그렸다.
//
// 축을 0에서 시작한다(막대와 같은 이유). 눈금값이 아니라 **모양**을 보여 주는
// 그림이라 y축 숫자는 굳이 찍지 않고, 대신 시작·끝 값을 글로 적는다.
export function lineSvg({ series = [], title = "", width = 680, height = 120 } = {}) {
  const pts = (series || []).map(Number).filter((n) => Number.isFinite(n) && n >= 0);
  if (pts.length < 2) return "";
  const max = Math.max(...pts, 1);
  const padT = title ? 26 : 8;
  const padB = 14;
  const padX = 6;
  const w = width - padX * 2;
  const h = height - padT - padB;
  const x = (i) => padX + (i / (pts.length - 1)) * w;
  const y = (v) => padT + h - (v / max) * h;
  const d = pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const area = `${d} L${x(pts.length - 1).toFixed(1)} ${padT + h} L${x(0).toFixed(1)} ${padT + h} Z`;
  return `<figure class="chart"><svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img"
    aria-label="${esc(title || "시간에 따른 변화")}" xmlns="http://www.w3.org/2000/svg">
    ${title ? `<text x="0" y="14" class="ch-ti">${esc(title)}</text>` : ""}
    <path d="${area}" class="ch-area"></path>
    <path d="${d}" class="ch-line" fill="none"></path>
    <circle cx="${x(pts.length - 1).toFixed(1)}" cy="${y(pts[pts.length - 1]).toFixed(1)}" r="3" class="ch-dot"></circle>
  </svg></figure>`;
}

// 발행 페이지에 넣는 차트 스타일. 색은 화면 테마 변수를 따라간다.
export const CHART_CSS = `
.chart{margin:14px 0 18px;padding:0;overflow-x:auto}
.chart svg{display:block;max-width:100%}
/* 발행 페이지(editionShell)는 --text/--accent를, 앱 화면은 --color-text/
   --color-accent를 쓴다. 처음엔 앱 쪽 이름만 참조해서 발행 페이지에서는
   **항상 대체값(#14100e)으로 굳었고**, OS 다크모드에서 차트 제목과 값 숫자가
   배경(#171615)과 거의 같은 색이 됐다(대비 1.05:1 — 사실상 안 보임).
   검수 2026-08-06 P1. 두 이름을 모두 본다. */
.ch-ti{font:800 13px var(--font-heading,inherit);fill:var(--text,var(--color-text,#201e1d))}
.ch-lb{font:600 12px inherit;fill:var(--muted,#6b6560)}
.ch-val{font:700 12px inherit;fill:var(--text,var(--color-text,#201e1d));font-variant-numeric:tabular-nums}
.ch-bar{fill:var(--accent,var(--color-accent,#ec3013));opacity:.85}
.ch-line{stroke:var(--accent,var(--color-accent,#ec3013));stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.ch-area{fill:var(--accent,var(--color-accent,#ec3013));opacity:.12}
.ch-dot{fill:var(--accent,var(--color-accent,#ec3013))}
`;
