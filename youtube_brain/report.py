"""
youtube_brain · 출력(ACT) — 콘솔·마크다운·(선택)이메일
=====================================================
지식 카드와 RAG 답변을 사람이 보기 좋게 렌더링한다. 이메일은 neural-flow 와 동일 패턴.
"""

import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from .config import HERE, now_kst_iso

_LINE = "─" * 60


def fmt_duration(sec):
    sec = int(sec or 0)
    if sec <= 0:
        return ""
    h, m, s = sec // 3600, (sec % 3600) // 60, sec % 60
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def render_card_console(rec):
    L = [_LINE, f"📺 {rec.get('title', '(제목 없음)')}"]
    meta = " · ".join(x for x in [
        rec.get("channel", ""), fmt_duration(rec.get("duration_sec")),
        (f"조회 {rec.get('views'):,}" if rec.get("views") else ""), rec.get("category", ""),
    ] if x)
    if meta:
        L.append(f"   {meta}")
    L.append(f"   {rec.get('url', '')}")
    if rec.get("note"):
        L.append(f"   ⚠️ {rec['note']}")
    if rec.get("one_liner"):
        L += ["", f"💡 {rec['one_liner']}"]
    if rec.get("tl_dr"):
        L += ["", "[핵심 요약]"] + [f"  • {t}" for t in rec["tl_dr"]]
    if rec.get("key_points"):
        L += ["", "[주요 포인트]"] + [f"  - {t}" for t in rec["key_points"]]
    if rec.get("takeaways"):
        L += ["", "[💼 내게 주는 시사점]"] + [f"  → {t}" for t in rec["takeaways"]]
    if rec.get("keywords"):
        L += ["", "🏷️  " + " ".join("#" + k for k in rec["keywords"])]
    L.append(_LINE)
    return "\n".join(L)


def render_answer_console(res):
    L = [_LINE, f"❓ {res.get('question', '')}", _LINE]
    if res.get("answer"):
        L.append(res["answer"])
        L.append("\n[출처 — 내 지식DB]")
        for i, s in enumerate(res.get("sources", []), 1):
            L.append(f"  [{i}] {s.get('title', '')}  ({s.get('url', '')})")
    elif res.get("sources"):
        # LLM 키 없을 때도 빈손이 아니게: 저장된 카드에서 바로 발췌해 보여준다
        for i, s in enumerate(res["sources"], 1):
            L.append(f"\n[{i}] {s.get('title', '')}  ({s.get('url', '')})")
            if s.get("one_liner"):
                L.append(f"    💡 {s['one_liner']}")
            for t in (s.get("tl_dr") or [])[:3]:
                L.append(f"    • {t}")
            for t in (s.get("takeaways") or [])[:2]:
                L.append(f"    → {t}")
    if res.get("note"):
        L.append(f"\nℹ️  {res['note']}")
    L.append(_LINE)
    return "\n".join(L)


# ── 마크다운 / 이메일 ─────────────────────────────────────────────────────────
def render_cards_md(recs, title="유튜브 지식"):
    out = [f"# 📺 {title}", f"> youtube_brain · {now_kst_iso()}", ""]
    for r in recs:
        out.append(f"## {r.get('title', '(제목 없음)')}")
        out.append(f"`{r.get('category', '')}` · {r.get('url', '')}")
        if r.get("one_liner"):
            out.append(f"\n**{r['one_liner']}**")
        if r.get("tl_dr"):
            out += ["\n**핵심 요약**"] + [f"- {t}" for t in r["tl_dr"]]
        if r.get("takeaways"):
            out += ["\n**💼 시사점**"] + [f"- {t}" for t in r["takeaways"]]
        if r.get("keywords"):
            out.append("\n" + " ".join("#" + k for k in r["keywords"]))
        out.append("\n---")
    return "\n".join(out)


def save_md(text, name):
    path = os.path.join(HERE, name)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    return path


def md_to_html(md):
    body = md.replace("&", "&amp;").replace("<", "&lt;").replace("\n", "<br>")
    return (f"<div style=\"font-family:'Apple SD Gothic Neo',sans-serif;max-width:720px;"
            f"margin:auto;padding:24px;color:#222;line-height:1.7\">{body}</div>")


def send_email(subject, html):
    """SENDER_EMAIL/PASSWORD 있으면 발송, 없으면 미리보기 파일로 저장(neural-flow 패턴)."""
    sender = os.environ.get("SENDER_EMAIL")
    pw = os.environ.get("SENDER_PASSWORD")
    to = os.environ.get("RECEIVER_EMAIL", sender)
    if not (sender and pw):
        path = save_md(html, "knowledge_preview.html")
        print(f"[report] 메일 자격증명 없음 → 미리보기 저장: {path}")
        return False
    msg = MIMEMultipart("alternative")
    msg["Subject"], msg["From"], msg["To"] = subject, f"youtube_brain <{sender}>", to
    msg.attach(MIMEText(html, "html"))
    try:
        s = smtplib.SMTP("smtp.gmail.com", 587)
        s.starttls()
        s.login(sender, pw)
        s.sendmail(sender, to, msg.as_string())
        s.quit()
        print(f"[report] 발송 완료 → {to}")
        return True
    except Exception as e:
        print(f"[report] 메일 실패: {e}")
        return False
