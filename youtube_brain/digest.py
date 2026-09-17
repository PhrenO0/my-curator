"""
youtube_brain · 주간 다이제스트
===============================
최근 N일 동안 새로 쌓인 지식 카드를 카테고리별로 모아 이메일로 보낸다.
키 없이도 동작(저장된 카드만 읽음). SENDER_EMAIL/PASSWORD 없으면 미리보기 파일로 저장.

실행:  python -m youtube_brain digest [--days 7]
환경:  SENDER_EMAIL / SENDER_PASSWORD / RECEIVER_EMAIL(선택)
"""

from datetime import datetime, timedelta

from .knowledge_base import KnowledgeBase
from .config import KST
from . import report


def recent_records(kb, days=7):
    """created_at(KST 'YYYY-MM-DD HH:MM:SS') 기준 최근 N일 카드."""
    cutoff = datetime.now(KST) - timedelta(days=days)
    out = []
    for r in kb.all_records():
        try:
            dt = datetime.strptime(r.get("created_at", ""), "%Y-%m-%d %H:%M:%S").replace(tzinfo=KST)
        except ValueError:
            continue
        if dt >= cutoff:
            out.append(r)
    return out


def render_digest_html(recs, days):
    today = datetime.now(KST).strftime("%Y-%m-%d")
    by_cat = {}
    for r in recs:
        by_cat.setdefault(r.get("category") or "기타", []).append(r)

    blocks = []
    for cat, items in sorted(by_cat.items(), key=lambda kv: -len(kv[1])):
        rows = []
        for r in items:
            take = "".join(
                f"<div style='color:#555;font-size:13px;margin-top:2px'>→ {t}</div>"
                for t in (r.get("takeaways") or [])[:2]
            )
            rows.append(
                f"<div style='margin:10px 0;padding-bottom:10px;border-bottom:1px solid #eee'>"
                f"<a href='{r.get('url', '#')}' style='color:#2563eb;font-weight:600;text-decoration:none'>"
                f"{r.get('title', '(제목 없음)')}</a>"
                f"<div style='color:#333;margin-top:3px'>{r.get('one_liner', '')}</div>{take}</div>"
            )
        blocks.append(
            f"<h3 style='color:#7c3aed;margin:18px 0 6px'>#{cat} "
            f"<span style='color:#aaa;font-size:14px'>({len(items)})</span></h3>" + "".join(rows)
        )

    return (
        "<div style=\"font-family:'Apple SD Gothic Neo',sans-serif;max-width:680px;margin:auto;"
        "padding:24px;color:#222\">"
        f"<h2 style='color:#0f172a'>📺 유튜브 지식 주간 다이제스트 · {today}</h2>"
        f"<p style='color:#666'>최근 {days}일 새로 쌓은 지식 <b>{len(recs)}</b>개</p>"
        + "".join(blocks)
        + "<p style='color:#aaa;font-size:12px;margin-top:20px'>youtube_brain · 자막→Gemini 요약→지식DB</p></div>"
    )


def run(days=7):
    print(f"📺 유튜브 지식 주간 다이제스트 (최근 {days}일)")
    kb = KnowledgeBase()
    recs = recent_records(kb, days)
    if not recs:
        print(f"  최근 {days}일 새 지식 없음 — 발송 생략")
        return None
    html = render_digest_html(recs, days)
    report.send_email(f"📺 유튜브 지식 주간 다이제스트 ({len(recs)}개)", html)
    print(f"  ✅ {len(recs)}개 다이제스트 처리 완료")
    return html
