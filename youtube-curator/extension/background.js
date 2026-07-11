// My Curator 서비스 워커
// 저장 경로 두 갈래 (옵션에서 선택, 기본 both):
//   1) obsidian://new URI — 옵시디언 로컬 볼트에 즉시 노트 생성
//   2) GitHub repository_dispatch — my-curator 파이프라인(agent.py)이
//      메타데이터 수집 → vault/ 노트 커밋 → 노션 GTD 동기화까지 수행

const DEFAULTS = {
  mode: "both", // both | obsidian | github
  ghRepo: "PhrenO0/my-curator",
  ghToken: "",
  vault: "MyVault",
  folder: "YouTube",
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "mc-save-link",
    title: "🗂️ My Curator에 저장",
    contexts: ["link", "page"],
    documentUrlPatterns: ["https://www.youtube.com/*"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const url = info.linkUrl || info.pageUrl;
  if (url) save({ url, title: tab?.title?.replace(/ - YouTube$/, "") || "", channel: "" });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "save") {
    save(msg.video).then(sendResponse);
    return true; // async
  }
  if (msg.type === "recent") {
    chrome.storage.local.get({ recent: [] }).then(sendResponse);
    return true;
  }
});

function extractVideoId(url) {
  const m = (url || "").match(/(?:v=|\/embed\/|\/shorts\/|\/live\/|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

async function save(video) {
  const videoId = extractVideoId(video.url);
  if (!videoId) return { ok: false, error: "유튜브 영상 URL이 아님" };
  const cfg = await chrome.storage.sync.get(DEFAULTS);
  const cleanUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const errors = [];

  if (cfg.mode === "both" || cfg.mode === "obsidian") {
    try {
      await saveToObsidian({ ...video, url: cleanUrl, videoId }, cfg);
    } catch (e) {
      errors.push("옵시디언: " + e.message);
    }
  }
  if (cfg.mode === "both" || cfg.mode === "github") {
    try {
      await dispatchToGitHub({ ...video, url: cleanUrl }, cfg);
    } catch (e) {
      errors.push("GitHub: " + e.message);
    }
  }

  if (errors.length < (cfg.mode === "both" ? 2 : 1)) {
    await pushRecent({ videoId, url: cleanUrl, title: video.title, at: Date.now() });
    return { ok: true, warn: errors.join(" / ") || undefined };
  }
  return { ok: false, error: errors.join(" / ") };
}

async function saveToObsidian(video, cfg) {
  const today = new Date().toISOString().slice(0, 10);
  const safeTitle = (video.title || video.videoId)
    .replace(/[\\/:*?"<>|#^\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  const content = [
    "---",
    `title: "${(video.title || "").replaceAll('"', "'")}"`,
    `channel: "${(video.channel || "").replaceAll('"', "'")}"`,
    `url: ${video.url}`,
    `video_id: ${video.videoId}`,
    "tags: [youtube]",
    "status: inbox",
    `added: ${today}`,
    "source: 확장프로그램",
    "---",
    "",
    `![썸네일](https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg)`,
    "",
    `▶️ [영상 보기](${video.url})`,
    "",
    "## 내 노트",
    "- ",
  ].join("\n");
  const uri =
    "obsidian://new?vault=" + encodeURIComponent(cfg.vault) +
    "&file=" + encodeURIComponent(`${cfg.folder}/${today} ${safeTitle}`) +
    "&content=" + encodeURIComponent(content) +
    "&silent=true";
  const tab = await chrome.tabs.create({ url: uri, active: false });
  setTimeout(() => chrome.tabs.remove(tab.id).catch(() => {}), 3000);
}

async function dispatchToGitHub(video, cfg) {
  if (!cfg.ghToken) throw new Error("토큰 없음(옵션에서 설정)");
  const res = await fetch(`https://api.github.com/repos/${cfg.ghRepo}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.ghToken}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      event_type: "youtube-save",
      client_payload: { urls_text: video.url, title: video.title, channel: video.channel },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function pushRecent(entry) {
  const { recent } = await chrome.storage.local.get({ recent: [] });
  const next = [entry, ...recent.filter((r) => r.videoId !== entry.videoId)].slice(0, 20);
  await chrome.storage.local.set({ recent: next });
}
