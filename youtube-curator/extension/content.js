// 유튜브 시청 페이지에 떠 있는 "옵시디언 저장" 버튼을 심는다.
// 유튜브는 SPA 라서 yt-navigate-finish 이벤트로 페이지 전환을 감지한다.

const BTN_ID = "my-curator-save-btn";

function isWatchPage() {
  return location.pathname === "/watch" || location.pathname.startsWith("/shorts/");
}

function getVideoInfo() {
  const title =
    document.querySelector("h1.ytd-watch-metadata yt-formatted-string")?.textContent?.trim() ||
    document.title.replace(/ - YouTube$/, "").trim();
  const channel =
    document.querySelector("ytd-channel-name #text a")?.textContent?.trim() || "";
  return { url: location.href, title, channel };
}

function setState(btn, state, label) {
  btn.dataset.state = state;
  btn.querySelector(".mc-label").textContent = label;
}

function ensureButton() {
  let btn = document.getElementById(BTN_ID);
  if (!isWatchPage()) {
    btn?.remove();
    return;
  }
  if (btn) {
    setState(btn, "idle", "저장");
    return;
  }
  btn = document.createElement("button");
  btn.id = BTN_ID;
  btn.innerHTML = '<span class="mc-icon">🗂️</span><span class="mc-label">저장</span>';
  btn.title = "My Curator — 옵시디언·노션에 저장";
  btn.addEventListener("click", () => {
    if (btn.dataset.state === "saving") return;
    setState(btn, "saving", "저장 중…");
    chrome.runtime.sendMessage({ type: "save", video: getVideoInfo() }, (res) => {
      if (chrome.runtime.lastError || !res?.ok) {
        setState(btn, "error", res?.error || "실패 — 옵션 확인");
        setTimeout(() => setState(btn, "idle", "저장"), 4000);
      } else {
        setState(btn, "saved", "저장됨 ✓");
      }
    });
  });
  document.body.appendChild(btn);
}

window.addEventListener("yt-navigate-finish", () => setTimeout(ensureButton, 500));
ensureButton();
