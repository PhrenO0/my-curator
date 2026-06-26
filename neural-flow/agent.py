"""
neural-flow — 이상적인 삶 멘토링 에이전트
==========================================

준상의 'curator_bot' 과 똑같은 구조(파이썬 → Gemini → 이메일)로 만든,
매일 아침 너를 관리·멘토링하는 에이전트.

에이전트 루프 (이게 핵심 개념이다):
    1. SENSE  — 상태를 읽는다 (state.json = 비전·9개 영역·활동·고정일정 / 선택: 라이브 Notion)
    2. THINK  — Gemini가 비전에서 역산해 '오늘의 단 하나' 와 코칭을 만든다
    3. ACT    — 이메일로 브리핑을 보내고, (선택) Notion 허브에 오늘의 단 하나를 기록한다
    4. REMEMBER — 완료/회고가 다음 추천을 보정한다 (weekly 모드)

실행:
    python neural-flow/agent.py            # daily 브리핑
    NEURAL_FLOW_MODE=weekly python neural-flow/agent.py   # 주간 추천+회고

필요 환경변수 (curator 가 이미 쓰는 것 재사용):
    GOOGLE_API_KEY      — Gemini
    SENDER_EMAIL        — Gmail 주소
    SENDER_PASSWORD     — Gmail 앱 비밀번호
선택:
    GEMINI_MODEL        — 기본 gemini-2.5-flash
    RECEIVER_EMAIL      — 기본 SENDER_EMAIL
    NOTION_TOKEN        — 있으면 Notion 허브에 오늘의 단 하나 기록 (notion_sync.py)
    NEURAL_FLOW_MODE    — daily(기본) | weekly
"""

import os
import json
import smtplib
from datetime import datetime, timezone, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

HERE = os.path.dirname(os.path.abspath(__file__))
STATE_PATH = os.path.join(HERE, "state.json")
KST = timezone(timedelta(hours=9))


# ── 1. SENSE ────────────────────────────────────────────────────────────────
def load_state():
    """장기 기억을 읽는다. NOTION_TOKEN 이 있으면 라이브 활동을 덮어쓴다(graceful)."""
    with open(STATE_PATH, "r", encoding="utf-8") as f:
        state = json.load(f)
    if os.environ.get("NOTION_TOKEN"):
        try:
            from notion_sync import pull_live_activities
            live = pull_live_activities(state["notion"]["activity_database_id"])
            if live:
                state["activities"] = live
                print(f"[SENSE] Notion 라이브 활동 {len(live)}개 로드")
        except Exception as e:
            print(f"[SENSE] Notion 라이브 로드 실패(스냅샷 사용): {e}")
    return state


def kst_today():
    return datetime.now(KST)


def compute_deadlines(state, today):
    """고정일정/마감까지 남은 일수를 계산(결정론적 — LLM에 맡기지 않는다)."""
    out = []
    for b in state.get("fixed_blocks", []):
        raw = b.get("date")
        if not raw:
            continue
        try:
            d = datetime.fromisoformat(raw.replace("Z", "")).date()
        except ValueError:
            continue
        days = (d - today.date()).days
        if -1 <= days <= 14:
            out.append({"title": b["title"], "date": str(d), "d": days})
    return sorted(out, key=lambda x: x["d"])


def compute_balance(state):
    """9개 영역별 활동 수를 세고, 가장 비어있는 영역을 찾는다."""
    counts = {d["name"]: 0 for d in state["domains"]}
    for a in state.get("activities", []):
        if a.get("domain") in counts:
            counts[a["domain"]] += 1
    weakest = sorted(counts.items(), key=lambda kv: kv[1])[:2]
    return counts, [name for name, _ in weakest]


# ── 2. THINK ────────────────────────────────────────────────────────────────
def get_llm():
    key = os.environ.get("GOOGLE_API_KEY")
    if not key:
        return None
    from langchain_google_genai import ChatGoogleGenerativeAI
    return ChatGoogleGenerativeAI(
        model=os.environ.get("GEMINI_MODEL", "gemini-2.5-flash"),
        google_api_key=key,
        temperature=0.4,
    )


def build_prompt(state, today, deadlines, balance_counts, weakest, mode):
    v = state["vision"]
    weekday = ["월", "화", "수", "목", "금", "토", "일"][today.weekday()]
    activities = [a for a in state.get("activities", []) if a.get("status") != "완료"]
    extra = ""
    if mode == "weekly":
        extra = (
            "\n[주간 모드] 추가로 'recommendations' 배열에 다음 주 활동 3~5개를 제안하라"
            " (각: name, domain, why). 특히 가장 비어있는 영역을 채워라.\n"
        )
    return f"""너는 준상의 이상적인 삶 멘토 'neural-flow'다. 단순 비서가 아니라 비전에서 역산해 오늘을 설계하는 코치다.

[준상의 비전]
- 중심축: {v['core_axis']}
- North Star: {v['north_star']}
- 약점/처방: {v['weakness']}
- 신앙: {v['faith']}

[오늘] {today.strftime('%Y-%m-%d')} ({weekday})
[마감 카운트다운] {json.dumps(deadlines, ensure_ascii=False)}
[9개 영역 활동 분포] {json.dumps(balance_counts, ensure_ascii=False)}
[가장 비어있는 영역] {weakest}
[미완료 활동] {json.dumps(activities, ensure_ascii=False)}
{extra}
원칙: 과확장 금지. '오늘의 단 하나'는 무조건 1개. 마감 임박 > 고가치 > 영성 순. 신앙은 진지하게.

아래 JSON 만 출력하라(코드펜스 금지):
{{
  "greeting": "한 문장 인사(현재의 거룩=집중 상태를 일깨우는)",
  "one_thing": "오늘 반드시 끝낼 핵심 행동 1개",
  "one_thing_why": "그게 왜 오늘인지 + North Star/거룩과의 연결 한 줄",
  "holiness_line": "오늘의 거룩 한 줄(기도/말씀/다짐)",
  "stuck_coaching": "가장 비어있는 영역에 대한 부드러운 코칭 한 줄",
  "trend": "AI·마케팅 트렌드 한 줄(커리어에 도움, 없으면 빈 문자열)"{', "recommendations": [{"name":"", "domain":"", "why":""}]' if mode == 'weekly' else ''}
}}"""


def think(state, today, deadlines, balance_counts, weakest, mode):
    llm = get_llm()
    prompt = build_prompt(state, today, deadlines, balance_counts, weakest, mode)
    if llm is None:
        # LLM 키가 없을 때도 시스템이 죽지 않게 — 결정론적 폴백
        urgent = deadlines[0]["title"] if deadlines else "오늘의 핵심 1개를 정한다"
        return {
            "greeting": "지금 이 순간의 거룩=집중 상태로 하루를 연다.",
            "one_thing": urgent,
            "one_thing_why": "마감/우선순위 기준 자동 선정 (Gemini 키 없음).",
            "holiness_line": "여호와를 경외하는 것이 지혜의 근본.",
            "stuck_coaching": f"가장 비어있는 영역: {', '.join(weakest)} — 작게 한 걸음.",
            "trend": "",
        }
    raw = (llm.invoke(prompt).content or "").strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1].lstrip("json").strip() if "```" in raw else raw
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        start, end = raw.find("{"), raw.rfind("}")
        return json.loads(raw[start:end + 1])


# ── 3. ACT ──────────────────────────────────────────────────────────────────
def render_html(state, today, brief, deadlines, balance_counts, mode):
    from brief_email import render
    return render(state, today, brief, deadlines, balance_counts, mode)


def send_email(subject, html):
    sender = os.environ.get("SENDER_EMAIL")
    password = os.environ.get("SENDER_PASSWORD")
    receiver = os.environ.get("RECEIVER_EMAIL", sender)
    if not sender or not password:
        out = os.path.join(HERE, "brief_preview.html")
        with open(out, "w", encoding="utf-8") as f:
            f.write(html)
        print(f"[ACT] 이메일 자격증명 없음 → 미리보기 저장: {out}")
        return
    msg = MIMEMultipart("alternative")
    msg["Subject"], msg["From"], msg["To"] = subject, f"neural-flow <{sender}>", receiver
    msg.attach(MIMEText(html, "html"))
    try:
        server = smtplib.SMTP("smtp.gmail.com", 587)
        server.starttls()
        server.login(sender, password)
        server.sendmail(sender, receiver, msg.as_string())
        server.quit()
        print(f"[ACT] 브리핑 발송 완료 → {receiver}")
    except Exception as e:
        print(f"[ACT] 이메일 발송 실패: {e}")


def maybe_write_back(state, today, brief):
    if not os.environ.get("NOTION_TOKEN"):
        return
    try:
        from notion_sync import log_one_thing
        log_one_thing(state["notion"]["hub_page_id"], today, brief)
        print("[ACT] Notion 허브에 오늘의 단 하나 기록")
    except Exception as e:
        print(f"[ACT] Notion 기록 실패: {e}")


def send_telegram(text):
    """있으면 텔레그램으로도 보낸다 (헤르메스/봇 채널)."""
    try:
        from tg import send_message
        if send_message(text):
            print("[ACT] 텔레그램 발송")
    except Exception as e:
        print(f"[ACT] 텔레그램 스킵: {e}")


def _wd(today):
    return ["월", "화", "수", "목", "금", "토", "일"][today.weekday()]


def build_text(today, brief, deadlines):
    """데일리 브리핑의 텔레그램용 짧은 버전."""
    dl = ""
    if deadlines:
        d = deadlines[0]
        tag = "오늘" if d["d"] == 0 else f"D-{d['d']}"
        dl = f"\n⏳ {tag} {d['title']}"
    return (
        f"🌊 <b>neural-flow · {today.strftime('%m/%d')}({_wd(today)})</b>\n\n"
        f"☀️ <b>오늘의 단 하나</b>\n→ {brief.get('one_thing','')}\n"
        f"<i>{brief.get('one_thing_why','')}</i>{dl}\n\n"
        f"✝️ {brief.get('holiness_line','')}"
    )


def build_checkin_text(today, brief):
    """저녁 체크인(양방향)의 텔레그램용 메시지."""
    return (
        f"🌙 <b>저녁 체크인 · {today.strftime('%m/%d')}({_wd(today)})</b>\n\n"
        f"오늘의 단 하나였어:\n“{brief.get('one_thing','')}”\n\n"
        f"했어? 👉 했으면 ✅<b>완료</b>, 못 했으면 내일로 옮기자.\n"
        f"(헤르메스에게 '했어/못했어'로 답하면 노션에 자동 기록)\n\n"
        f"✝️ {brief.get('holiness_line','')}"
    )


# ── main ────────────────────────────────────────────────────────────────────
def run(mode="daily"):
    print(f"🌊 neural-flow agent — {mode} 모드 시작")
    state = load_state()                                   # SENSE
    today = kst_today()
    deadlines = compute_deadlines(state, today)
    counts, weakest = compute_balance(state)

    if mode == "checkin":                                  # 저녁 양방향 체크인
        brief = think(state, today, deadlines, counts, weakest, "daily")
        text = build_checkin_text(today, brief)
        send_telegram(text)
        send_email(f"🌙 오늘의 단 하나 했어? — {brief.get('one_thing','')[:24]}",
                    f"<div style='font-family:sans-serif;font-size:1.05em'>{text.replace(chr(10), '<br>')}</div>")
        print("✅ 체크인 완료")
        return

    brief = think(state, today, deadlines, counts, weakest, mode)   # THINK
    html = render_html(state, today, brief, deadlines, counts, mode)
    subject = f"🌊 neural-flow · {today.strftime('%m/%d')} 오늘의 단 하나: {brief.get('one_thing','')[:30]}"
    send_email(subject, html)                              # ACT (이메일)
    send_telegram(build_text(today, brief, deadlines))     # ACT (텔레그램)
    maybe_write_back(state, today, brief)                  # ACT (Notion)
    print("✅ 완료")


if __name__ == "__main__":
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass
    run(os.environ.get("NEURAL_FLOW_MODE", "daily"))
