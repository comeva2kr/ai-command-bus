// 안심스캔 백그라운드 — 브라우저가 켜져 있는 동안 상주한다.
//
// 콘텐츠 스크립트가 상품 페이지에서 계산한 점수를 받아 그 탭의 툴바 아이콘에
// 배지로 띄운다. 쇼핑몰 탭을 여러 개 열어 둬도 탭마다 점수가 따로 보인다.
// 탭이 다른 페이지로 이동하면 크롬이 탭별 배지를 알아서 지운다.

const COLORS = { green: "#2f9e62", yellow: "#c98a12", red: "#d64541", gray: "#6b7279" };

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== "ansim:score" || !sender.tab?.id) return;
  const tabId = sender.tab.id;
  chrome.action.setBadgeText({ tabId, text: String(msg.score ?? "").slice(0, 4) });
  chrome.action.setBadgeBackgroundColor({ tabId, color: COLORS[msg.tone] || COLORS.gray });
});
