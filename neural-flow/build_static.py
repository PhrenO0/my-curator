"""
neural-flow 정적 대시보드 빌더
==============================
state.json + experiences.json을 읽어 '자체 완결형 HTML 1파일'로 굽는다.
Vercel 없이 폰/브라우저에서 그냥 열면 보인다 (데이터 인라인, 외부 의존 0).

실행:  python neural-flow/build_static.py [출력경로]
기본 출력: neural-flow/dashboard.html
"""
import os
import sys
import json
import math
import html
from datetime import datetime, timezone, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
KST = timezone(timedelta(hours=9))

DOMAIN_COLOR = {
    "✝️ 영성·내면": "#a78bfa", "🧠 정신·심리": "#60a5fa", "🫀 신체·건강": "#34d399",
    "📚 지성·성장": "#fbbf24", "🤝 관계·사랑": "#f472b6", "💼 일·소명": "#c4956c",
    "💰 재정·경제": "#fb923c", "🎨 창조·표현": "#f87171", "🔁 환경·일상": "#94a3b8",
}


def esc(s):
    return html.escape(str(s or ""))


def days_between(target, today):
    t = datetime.fromisoformat(target.replace("Z", "")[:10] + "T00:00:00").date()
    return (t - today.date()).days


def build():
    state = json.load(open(os.path.join(HERE, "state.json"), encoding="utf-8"))
    exps = json.load(open(os.path.join(HERE, "experiences.json"), encoding="utf-8"))["experiences"]
    today = datetime.now(KST)
    todw = ["월", "화", "수", "목", "금", "토", "일"][today.weekday()]
    ymd = today.strftime("%Y-%m-%d")
    acts = state.get("activities", [])

    # 오늘의 단 하나
    dated = [a for a in acts if a.get("date")]
    one = (next((a for a in dated if a["date"] == ymd and a.get("priority") == "높음"), None)
           or next(iter(sorted([a for a in dated if a.get("priority") == "높음" and days_between(a["date"], today) >= 0],
                               key=lambda a: days_between(a["date"], today))), None)
           or next((a for a in acts if a.get("priority") == "높음"), None))

    # 마감
    deadlines = sorted(
        [{"title": b["title"], "date": b["date"], "d": days_between(b["date"], today)}
         for b in state.get("fixed_blocks", []) if b.get("date")
         and -1 <= days_between(b["date"], today) <= 14],
        key=lambda x: x["d"])

    # 9영역
    counts = [{"name": dm["name"], "n": sum(1 for a in acts if a.get("domain") == dm["name"])}
              for dm in state["domains"]]

    # 이번 주
    week = sorted([a for a in dated if 0 <= days_between(a["date"], today) <= 7],
                  key=lambda a: days_between(a["date"], today))

    # 인생수레바퀴
    scores = state.get("wheel_of_life", {}).get("scores", {})
    R, C = 86, 110
    wheel = []
    for i, dm in enumerate(state["domains"]):
        ang = math.radians(-90 + i * (360 / 9))
        sc = scores.get(dm["name"], 0)
        r = sc / 10 * R
        wheel.append({"emoji": dm["name"].split(" ")[0], "score": sc,
                      "color": DOMAIN_COLOR.get(dm["name"], "#94a3b8"),
                      "x": C + r * math.cos(ang), "y": C + r * math.sin(ang),
                      "ax": C + R * math.cos(ang), "ay": C + R * math.sin(ang),
                      "lx": C + (R + 16) * math.cos(ang), "ly": C + (R + 16) * math.sin(ang)})
    poly = " ".join(f"{w['x']:.1f},{w['y']:.1f}" for w in wheel)
    avg = sum(w["score"] for w in wheel) / (len(wheel) or 1)
    low = sorted(wheel, key=lambda w: w["score"])[:2]

    cm = state.get("goals", {}).get("career_map", {})
    yk = next((k for k in cm.get("skill_tree", {}) if k.startswith(str(today.year))),
              next(iter(cm.get("skill_tree", {})), None))
    cy = cm.get("skill_tree", {}).get(yk, {}) if yk else {}
    gate = next(iter(cm.get("decision_gates", {}).values()), "")

    flagship = next((e for e in exps if e["id"] == "neural-flow"), None)
    cases = [e for e in exps if e["id"] != "neural-flow"]
    fit = cm.get("market_fit_2026", {})
    fit_rows = [("오후 안에 vibe-code MVP", fit.get("vibe_code_mvp")),
                ("agentic AI 이해", fit.get("agentic_ai")),
                ("RAG로 데이터 접지", fit.get("rag")),
                ("해본 사람만 뽑힌다", fit.get("done_the_job"))]

    # ── HTML ──
    def card(inner, extra=""):
        return f'<section style="background:#1e293b;border-radius:16px;padding:20px;margin-bottom:16px;{extra}">{inner}</section>'

    H = '<h2 style="font-size:14px;letter-spacing:1px;color:#94a3b8;margin:0 0 12px;text-transform:uppercase">{}</h2>'

    parts = []
    # header
    parts.append(f'''<header style="margin-bottom:24px">
      <div style="color:#38bdf8;font-weight:700;letter-spacing:2px">🌊 NEURAL-FLOW</div>
      <h1 style="margin:4px 0 6px;font-size:26px">{ymd} ({todw})</h1>
      <p style="color:#94a3b8;margin:0;line-height:1.6">{esc(state["vision"]["core_axis"])}</p></header>''')

    # 오늘의 단 하나
    parts.append(card(
        f'''<div style="color:#fbbf24;font-weight:700;font-size:13px">☀️ 오늘의 단 하나</div>
        <div style="font-size:22px;font-weight:800;margin:8px 0">{esc(one["name"] if one else "오늘의 핵심 1개를 정하세요")}</div>
        <div style="color:#cbd5e1;line-height:1.6">{esc(one.get("why") if one else "")}</div>
        {f'<div style="margin-top:10px;font-size:13px;color:#94a3b8">{esc(one["domain"])} · {esc(one.get("energy"))} · {one.get("min",0)}분</div>' if one else ""}''',
        "background:linear-gradient(135deg,#f59e0b22,#1e293b 60%);border:1px solid #f59e0b55"))

    # 커리어맵
    if cm:
        parts.append(card(
            H.format(f'🧭 커리어맵 · {esc(cm.get("version",""))}') +
            f'<div style="font-weight:700;line-height:1.5;margin-bottom:10px">{esc(cm.get("positioning",""))}</div>' +
            (f'''<div style="font-size:13px;color:#cbd5e1;line-height:1.7">
                <div><b style="color:#38bdf8">올해 · {esc(yk)}</b></div>
                <div>· 역량: {esc(cy.get("역량"))}</div>
                <div>· 증명물: {esc(cy.get("증명물"))}</div>
                <div>· 게이트: {esc(cy.get("게이트"))}</div></div>''' if cy else "") +
            (f'<div style="margin-top:10px;font-size:12px;color:#64748b">⛳ 다음 분기: {esc(gate)}</div>' if gate else ""),
            "border:1px solid #38bdf855"))

    # 마감
    dl = ""
    for d in deadlines:
        lbl = "오늘" if d["d"] == 0 else ("지남" if d["d"] < 0 else f"D-{d['d']}")
        col = "#f87171" if d["d"] <= 1 else ("#fb923c" if d["d"] <= 3 else "#94a3b8")
        dl += f'''<div style="display:flex;gap:12px;padding:6px 0;border-bottom:1px solid #334155">
            <span style="color:{col};font-weight:700;width:48px">{lbl}</span>
            <span style="flex:1">{esc(d["title"])}</span><span style="color:#64748b">{esc(d["date"])}</span></div>'''
    parts.append(card(H.format("⏳ 마감 카운트다운") + (dl or '<div style="color:#64748b">임박한 마감 없음</div>')))

    # 9영역
    chips = ""
    for c in counts:
        col = DOMAIN_COLOR.get(c["name"], "#94a3b8")
        z = c["n"] == 0
        chips += f'''<span style="padding:6px 12px;border-radius:999px;font-size:13px;
            background:{'#0f172a' if z else col+'22'};border:1px solid {'#334155' if z else col+'66'};
            color:{'#475569' if z else '#e2e8f0'}">{esc(c["name"])} <b style="color:{col}">{'·' if z else c["n"]}</b></span>'''
    parts.append(card(H.format("🌳 9개 영역 균형") + f'<div style="display:flex;flex-wrap:wrap;gap:8px">{chips}</div>'))

    # 인생수레바퀴
    rings = "".join(f'<circle cx="{C}" cy="{C}" r="{g/10*R:.1f}" fill="none" stroke="#334155" stroke-width="0.5"/>' for g in (2, 4, 6, 8, 10))
    axes = "".join(f'<line x1="{C}" y1="{C}" x2="{w["ax"]:.1f}" y2="{w["ay"]:.1f}" stroke="#334155" stroke-width="0.5"/>' for w in wheel)
    dots = "".join(f'<circle cx="{w["x"]:.1f}" cy="{w["y"]:.1f}" r="2.5" fill="{w["color"]}"/>' for w in wheel)
    labels = "".join(f'<text x="{w["lx"]:.1f}" y="{w["ly"]:.1f}" font-size="11" text-anchor="middle" dominant-baseline="middle">{w["emoji"]}</text>' for w in wheel)
    svg = f'''<svg viewBox="0 0 220 220" width="100%" style="max-width:320px">{rings}{axes}
        <polygon points="{poly}" fill="#38bdf833" stroke="#38bdf8" stroke-width="1.5"/>{dots}{labels}</svg>'''
    lowtxt = " · ".join(f'{w["emoji"]} {w["score"]}' for w in low)
    parts.append(card(H.format(f"🛞 인생수레바퀴 · 평균 {avg:.1f}/10") +
                      f'<div style="display:flex;justify-content:center">{svg}</div>' +
                      f'<div style="text-align:center;font-size:12px;color:#64748b;margin-top:6px">보강 영역: {lowtxt}</div>'))

    # 이번 주
    wk = ""
    for a in week:
        col = DOMAIN_COLOR.get(a["domain"], "#94a3b8")
        dd = days_between(a["date"], today)
        day = "오늘" if dd == 0 else ("내일" if dd == 1 else f"+{dd}일")
        wk += f'''<div style="display:flex;gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid #334155">
            <span style="width:44px;color:#94a3b8;font-size:13px">{day}</span>
            <span style="width:8px;height:8px;border-radius:999px;background:{col};flex-shrink:0"></span>
            <span style="flex:1">{esc(a["name"])}</span><span style="color:#64748b;font-size:12px">{esc(a.get("status"))}</span></div>'''
    parts.append(card(H.format(f"🗓️ 이번 주 ({len(week)})") + wk))

    # ── 포트폴리오 섹션 ──
    parts.append('<hr style="border:none;border-top:1px solid #334155;margin:36px 0"/>')
    parts.append(f'<div style="color:#38bdf8;font-weight:700;letter-spacing:2px;margin-bottom:6px">PORTFOLIO</div>')
    parts.append(f'<h1 style="margin:0 0 10px;font-size:26px;line-height:1.25">CX형 AI 서비스기획자<br><span style="color:#94a3b8;font-size:17px">= 짓고 파는 메이커</span></h1>')
    parts.append(f'<p style="color:#cbd5e1;margin:0 0 16px;line-height:1.7">{esc(state["vision"]["north_star"])}</p>')

    def tag(t, c="#94a3b8", b="#334155", bg="#0f172a"):
        return f'<span style="font-size:11px;color:{c};background:{bg};border:1px solid {b};border-radius:999px;padding:2px 8px;margin:0 6px 6px 0;display:inline-block">{esc(t)}</span>'

    if flagship:
        tags = "".join(tag(t) for t in ["RAG", "멀티에이전트", "vibe coding", "Notion×Calendar", "자동화"])
        parts.append(card(
            f'<div style="color:#38bdf8;font-weight:700;font-size:12px">★ FLAGSHIP — 내 문제를 직접 AI 제품으로</div>'
            f'<div style="font-size:20px;font-weight:800;margin:8px 0">{esc(flagship["title"])}</div>'
            f'<div style="color:#cbd5e1;line-height:1.7">{esc(flagship["one_liner"])}</div>'
            f'<div style="margin-top:10px">{tags}</div>'
            f'<div style="margin-top:10px;font-size:13px;color:#94a3b8">근거: {esc(flagship["proof"])}</div>',
            "background:linear-gradient(135deg,#38bdf822,#1e293b 60%);border:1px solid #38bdf855"))

    fr = ""
    for k, v in fit_rows:
        if v:
            fr += f'''<div style="display:flex;gap:12px;padding:7px 0;border-bottom:1px solid #334155;font-size:14px">
                <span style="width:150px;color:#94a3b8;flex-shrink:0">{esc(k)}</span><span style="flex:1">{esc(v)}</span></div>'''
    if fr:
        parts.append(card(H.format("2026 시장이 원하는 것 ↔ 나의 증명물") + fr))

    parts.append(H.format("핵심 프로젝트 (문제 → 설계 → 결과)"))
    for e in cases:
        mtags = "".join(tag(m, "#fbbf24", "#fbbf2455", "#fbbf2411") for m in e.get("metrics", []))
        stags = "".join(tag(s) for s in e.get("serves", []))
        parts.append(card(
            f'<div style="font-size:16px;font-weight:700">{esc(e["title"])}</div>'
            f'<div style="color:#cbd5e1;line-height:1.7;margin-top:6px">{esc(e["one_liner"])}</div>'
            f'<div style="margin-top:10px">{mtags}{stags}</div>'))

    parts.append(f'<footer style="text-align:center;color:#475569;font-size:12px;margin-top:28px">'
                 f'neural-flow · 정적 스냅샷 {ymd} · 과확장 금지 · 하루 단 하나</footer>')

    body = "\n".join(parts)
    doc = f'''<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>🌊 neural-flow — 대시보드</title></head>
<body style="margin:0;background:#0f172a;color:#e2e8f0;font-family:'Apple SD Gothic Neo','Malgun Gothic','Segoe UI',sans-serif;-webkit-font-smoothing:antialiased">
<main style="max-width:760px;margin:0 auto;padding:32px 18px 64px">
{body}
</main></body></html>'''
    return doc


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "dashboard.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(build())
    print(f"✅ 정적 대시보드 생성: {out} ({os.path.getsize(out)} bytes)")
