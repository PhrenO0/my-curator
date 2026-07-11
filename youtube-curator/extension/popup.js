const $ = (id) => document.getElementById(id);

function setStatus(text, ok = true) {
  $("status").textContent = text;
  $("status").style.color = ok ? "#8fd" : "#f88";
}

function saveVideo(video) {
  return new Promise((resolve) =>
    chrome.runtime.sendMessage({ type: "save", video }, resolve)
  );
}

$("save-current").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes("youtube.com")) {
    return setStatus("유튜브 탭이 아닙니다", false);
  }
  setStatus("저장 중…");
  const res = await saveVideo({
    url: tab.url,
    title: (tab.title || "").replace(/ - YouTube$/, ""),
    channel: "",
  });
  setStatus(res?.ok ? "저장됨 ✓" + (res.warn ? ` (${res.warn})` : "") : res?.error || "실패", !!res?.ok);
  loadRecent();
});

$("save-pasted").addEventListener("click", async () => {
  const urls = $("paste").value.split(/[\s,]+/).filter((u) => u.includes("yout"));
  if (!urls.length) return setStatus("유효한 링크가 없습니다", false);
  setStatus(`${urls.length}개 저장 중…`);
  let ok = 0;
  for (const url of urls) {
    const res = await saveVideo({ url, title: "", channel: "" });
    if (res?.ok) ok++;
  }
  setStatus(`${ok}/${urls.length}개 저장됨`, ok > 0);
  $("paste").value = "";
  loadRecent();
});

$("open-options").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

async function loadRecent() {
  const { recent = [] } = await chrome.runtime.sendMessage({ type: "recent" }) || {};
  $("recent").innerHTML = recent.length
    ? recent.map((r) =>
        `<li><a href="${r.url}" target="_blank">${r.title || r.videoId}</a></li>`).join("")
    : "<li style='color:#667'>아직 없음</li>";
}
loadRecent();
