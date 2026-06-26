// neural-flow 브리핑 발송 (Node 경로) — package.json "send-briefing" 스크립트.
// SENDER_EMAIL/SENDER_PASSWORD 있으면 Gmail SMTP로 발송, 없으면 미리보기 저장.
// 파이썬 agent.py 와 같은 일을 JS로 하는 가벼운 대안.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const state = JSON.parse(
  fs.readFileSync(path.join(root, "neural-flow/state.json"), "utf-8")
);

const kst = () =>
  new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
const ymd = (d) => d.toISOString().slice(0, 10);
const days = (target, today) =>
  Math.round(
    (new Date(target.slice(0, 10) + "T00:00:00") -
      new Date(ymd(today) + "T00:00:00")) /
      86400000
  );

const today = kst();
const todayStr = ymd(today);
const acts = state.activities;

const oneThing =
  acts.find((a) => a.date === todayStr && a.priority === "높음") ||
  acts
    .filter((a) => a.date && a.priority === "높음" && days(a.date, today) >= 0)
    .sort((a, b) => days(a.date, today) - days(b.date, today))[0] ||
  acts.find((a) => a.priority === "높음");

const deadlines = state.fixed_blocks
  .filter((b) => b.date)
  .map((b) => ({ title: b.title, date: b.date, d: days(b.date, today) }))
  .filter((b) => b.d >= -1 && b.d <= 14)
  .sort((a, b) => a.d - b.d);

const html = `<div style="font-family:'Apple SD Gothic Neo',sans-serif;max-width:640px;margin:auto;padding:24px;background:#fff;color:#222">
  <h2 style="color:#3498db">🌊 neural-flow · ${todayStr}</h2>
  <div style="background:#fef9e7;border-left:5px solid #f1c40f;padding:14px;border-radius:8px">
    <b>☀️ 오늘의 단 하나</b><br>
    <span style="font-size:1.2em;font-weight:bold">${oneThing?.name ?? ""}</span>
    <div style="color:#666;margin-top:4px">${oneThing?.why ?? ""}</div>
  </div>
  <h3>⏳ 마감 카운트다운</h3>
  <ul>${deadlines
    .map(
      (d) => `<li>${d.d === 0 ? "오늘" : "D-" + d.d} · ${d.title} (${d.date})</li>`
    )
    .join("")}</ul>
  <p style="color:#999;font-size:.85em">과확장 금지 · 하루 단 하나</p>
</div>`;

const sender = process.env.SENDER_EMAIL;
const pass = process.env.SENDER_PASSWORD;
const receiver = process.env.RECEIVER_EMAIL || sender;

if (!sender || !pass) {
  fs.writeFileSync(path.join(root, "neural-flow/brief_preview.html"), html);
  console.log("이메일 자격증명 없음 → neural-flow/brief_preview.html 저장");
  process.exit(0);
}

const nodemailer = (await import("nodemailer")).default;
const tx = nodemailer.createTransport({
  service: "gmail",
  auth: { user: sender, pass },
});
await tx.sendMail({
  from: `neural-flow <${sender}>`,
  to: receiver,
  subject: `🌊 오늘의 단 하나: ${oneThing?.name ?? ""}`.slice(0, 60),
  html,
});
console.log("브리핑 발송 완료 →", receiver);
