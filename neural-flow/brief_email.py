"""neural-flow 브리핑 → HTML 이메일 렌더링."""


def _deadline_rows(deadlines):
    if not deadlines:
        return "<p style='color:#95a5a6'>임박한 마감 없음</p>"
    rows = ""
    for d in deadlines:
        dd = d["d"]
        label = "오늘" if dd == 0 else ("지남" if dd < 0 else f"D-{dd}")
        color = "#c0392b" if dd <= 1 else "#e67e22" if dd <= 3 else "#7f8c8d"
        rows += (
            f"<tr><td style='padding:4px 10px;font-weight:bold;color:{color}'>{label}</td>"
            f"<td style='padding:4px 10px'>{d['title']}</td>"
            f"<td style='padding:4px 10px;color:#95a5a6'>{d['date']}</td></tr>"
        )
    return f"<table style='border-collapse:collapse'>{rows}</table>"


def _balance_bar(counts):
    cells = ""
    for name, n in counts.items():
        bg = "#ecf0f1" if n == 0 else "#d6eaf8"
        mark = "·" if n == 0 else str(n)
        cells += (
            f"<span style='display:inline-block;margin:3px;padding:5px 9px;border-radius:14px;"
            f"background:{bg};font-size:0.85em'>{name} <b>{mark}</b></span>"
        )
    return cells


def _inbox(state):
    flags = state.get("inbox_flags") or []
    if not flags:
        return ""
    items = "".join(f"<li style='margin:4px 0'>{f}</li>" for f in flags)
    return (
        "<h2 style='color:#34495e;margin-top:28px'>📨 메일에서 챙길 것</h2>"
        f"<ul style='line-height:1.5;color:#444'>{items}</ul>"
    )


def _reco(brief):
    recos = brief.get("recommendations") or []
    if not recos:
        return ""
    items = ""
    for r in recos:
        items += (
            f"<li style='margin:6px 0'><b>{r.get('domain','')}</b> · {r.get('name','')}"
            f"<br/><span style='color:#7f8c8d;font-size:0.9em'>{r.get('why','')}</span></li>"
        )
    return (
        "<h2 style='color:#34495e;margin-top:28px'>🗓️ 이번 주 추천 (승인하면 캘린더로)</h2>"
        f"<ul style='line-height:1.5'>{items}</ul>"
    )


def render(state, today, brief, deadlines, counts, mode):
    wd = ["월", "화", "수", "목", "금", "토", "일"][today.weekday()]
    trend = brief.get("trend") or ""
    trend_html = (
        f"<h2 style='color:#34495e;margin-top:28px'>🧠 트렌드 한 줄</h2><p>{trend}</p>"
        if trend else ""
    )
    return f"""<html><body style="font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;background:#f4f7f6;padding:20px;color:#2c3e50">
<div style="max-width:680px;margin:0 auto;background:#fff;border-radius:14px;padding:28px;box-shadow:0 4px 10px rgba(0,0,0,.06)">
  <p style="color:#3498db;font-weight:bold;letter-spacing:1px;margin:0">🌊 neural-flow</p>
  <h1 style="margin:4px 0 0;font-size:1.5em">{today.strftime('%Y년 %m월 %d일')} ({wd})</h1>
  <p style="color:#7f8c8d;margin:6px 0 20px">{brief.get('greeting','')}</p>

  <div style="background:#fef9e7;border-left:5px solid #f1c40f;border-radius:8px;padding:16px">
    <div style="color:#b7950b;font-weight:bold;font-size:.9em">☀️ 오늘의 단 하나</div>
    <div style="font-size:1.25em;font-weight:bold;margin:6px 0">{brief.get('one_thing','')}</div>
    <div style="color:#7f8c8d">{brief.get('one_thing_why','')}</div>
  </div>

  <h2 style="color:#34495e;margin-top:28px">⏳ 마감 카운트다운</h2>
  {_deadline_rows(deadlines)}
  {_inbox(state)}

  <h2 style="color:#34495e;margin-top:28px">🌳 9개 영역 균형</h2>
  <div>{_balance_bar(counts)}</div>
  <p style="color:#7f8c8d;margin-top:8px">💬 {brief.get('stuck_coaching','')}</p>

  <h2 style="color:#34495e;margin-top:28px">✝️ 거룩 한 줄</h2>
  <p style="background:#f4ecf7;border-radius:8px;padding:12px">{brief.get('holiness_line','')}</p>
  {trend_html}
  {_reco(brief)}

  <hr style="border:none;border-top:1px solid #eee;margin:28px 0"/>
  <p style="text-align:center;color:#bdc3c7;font-size:.8em">
    neural-flow · 과확장 금지, 하루 단 하나 · 활동은 노션 백로그에서 관리
  </p>
</div></body></html>"""
