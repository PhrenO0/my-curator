const DEFAULTS = {
  mode: "both",
  ghRepo: "PhrenO0/my-curator",
  ghToken: "",
  vault: "MyVault",
  folder: "YouTube",
};

const fields = Object.keys(DEFAULTS);

chrome.storage.sync.get(DEFAULTS).then((cfg) => {
  for (const f of fields) document.getElementById(f).value = cfg[f];
});

document.getElementById("save").addEventListener("click", async () => {
  const cfg = {};
  for (const f of fields) cfg[f] = document.getElementById(f).value.trim();
  if (!cfg.mode) cfg.mode = "both";
  await chrome.storage.sync.set(cfg);
  const saved = document.getElementById("saved");
  saved.textContent = "저장됨 ✓";
  setTimeout(() => (saved.textContent = ""), 2000);
});
