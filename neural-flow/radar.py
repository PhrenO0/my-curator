"""
neural-flow 기회·정보 레이더
============================
준상이 안 찾아다녀도 매주 '기회 + 기술/DB 최신정보'가 알아서 오게.

소스:
  - 한국 기회(채용·공모전·앰버서더·지원금): Naver 검색 API
  - 기술·DB 최신정보: Threads 공식 keyword_search (threads_source)
처리: Gemini가 준상 프로필에 맞춰 큐레이션 → 이메일.

실행:  python neural-flow/radar.py
환경:  NAVER_CLIENT_ID/SECRET, GOOGLE_API_KEY, SENDER_EMAIL/PASSWORD
선택:  THREADS_ACCESS_TOKEN(기술 레이더), RECEIVER_EMAIL, GEMINI_MODEL
"""

import os
import json
import urllib.parse
import smtplib
import requests
from datetime import datetime, timezone, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

HERE = os.path.dirname(os.path.abspath(__file__))
KST = timezone(timedelta(hours=9))

# 준상 프로필에 맞춘 기회 검색어
OPP_QUERIES = [
    "AI 마케팅 인턴 채용",
    "그로스 마케터 신입 채용",
    "대학생 마케팅 콘텐츠 공모전",
    "콘텐츠 앰버서더 서포터즈 모집",
    "청년 창업 지원사업 모집",
]
# 'Threads = 기술/DB 최신정보의 근원'
TECH_KEYWORDS = ["vector database", "RAG", "AI agent", "LLM", "데이터베이스", "프롬프트 엔지니어링"]


# ── 수집 ──────────────────────────────────────────────────────────────────────
def naver_search(query, kind="news", display=5):
    cid = os.environ.get("NAVER_CLIENT_ID")
    csec = os.environ.get("NAVER_CLIENT_SECRET")
    if not (cid and csec):
        return []
    url = (
        f"https://openapi.naver.com/v1/search/{kind}.json"
        f"?query={urllib.parse.quote(query)}&display={display}&sort=date"
    )
    try:
        from bs4 import BeautifulSoup
        r = requests.get(
            url,
            headers={"X-Naver-Client-Id": cid, "X-Naver-Client-Secret": csec},
            timeout=15,
        )
        return [
            {
                "title": BeautifulSoup(i["title"], "html.parser").get_text(),
                "desc": BeautifulSoup(i.get("description", ""), "html.parser").get_text(),
                "link": i.get("link", ""),
                "q": query,
            }
            for i in r.json().get("items", [])
        ]
    except Exception as e:
        print(f"[radar] Naver 실패({query}): {e}")
        return []


def collect():
    opps = []
    for q in OPP_QUERIES:
        opps += naver_search(q, "news", 5) + naver_search(q, "blog", 3)
    try:
        from threads_source import pull
        threads = pull(TECH_KEYWORDS, per=4)
    except Exception as e:
        print(f"[radar] Threads 스킵: {e}")
        threads = []
    return opps, threads


# ── 큐레이션 ──────────────────────────────────────────────────────────────────
def get_llm():
    key = os.environ.get("GOOGLE_API_KEY")
    if not key:
        return None
    from langchain_google_genai import ChatGoogleGenerativeAI
    return ChatGoogleGenerativeAI(
        model=os.environ.get("GEMINI_MODEL", "gemini-2.5-flash"),
        google_api_key=key,
        temperature=0.3,
    )


def curate(opps, threads):
    llm = get_llm()
    if llm is None:
        return {
            "opportunities": [
                {"title": o["title"], "why": o["q"], "link": o["link"]} for o in opps[:7]
            ],
            "tech": [
                {"summary": t["text"], "source": t.get("username", "")} for t in threads[:5]
            ],
            "one_move": "Gemini 키 없음 — 원본 상위 항목.",
        }
    prompt = f"""너는 준상의 커리어 멘토 'neural-flow 레이더'다.
준상: AI 그로스/콘텐츠 마케터 지망, 부동산 복수전공(프롭테크×AI 와일드카드), 생성형 AI 광고 수상,
선거캠프 숏폼 10만 조회. 약점은 과확장 → 적게, 정확히.

아래 원본에서 '지금 준상에게 가치 있는' 것만 골라 큐레이션하라.

[기회 원본 — 채용·공모전·앰버서더·지원금]
{json.dumps(opps[:30], ensure_ascii=False)[:6000]}

[Threads 기술·DB 최신글]
{json.dumps(threads[:20], ensure_ascii=False)[:4000]}

JSON만 출력(코드펜스 금지):
{{"opportunities":[{{"title":"","why":"준상에게 왜 중요한지 한 줄","link":""}}],
  "tech":[{{"summary":"기술/DB 핵심 한 줄","source":"username 또는 permalink"}}],
  "one_move":"이번 주 단 하나의 실행 추천"}}
기회 5~7개·기술 3~5개. 중요도순. 과확장 금지."""
    raw = (llm.invoke(prompt).content or "").strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1].lstrip("json").strip() if "```" in raw else raw
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        s, e = raw.find("{"), raw.rfind("}")
        return json.loads(raw[s : e + 1])


# ── 출력 ──────────────────────────────────────────────────────────────────────
def render(digest, today):
    opp = "".join(
        f"<li style='margin:8px 0'><a href='{o.get('link', '#')}' style='color:#2563eb'>{o.get('title', '')}</a>"
        f"<br><span style='color:#777'>{o.get('why', '')}</span></li>"
        for o in digest.get("opportunities", [])
    )
    tech = "".join(
        f"<li style='margin:6px 0'>{t.get('summary', '')} "
        f"<span style='color:#999;font-size:.9em'>({t.get('source', '')})</span></li>"
        for t in digest.get("tech", [])
    )
    return f"""<div style="font-family:'Apple SD Gothic Neo',sans-serif;max-width:660px;margin:auto;padding:24px;color:#222">
  <h2 style="color:#7c3aed">📡 neural-flow 레이더 · {today}</h2>
  <div style="background:#f3e8ff;border-left:4px solid #7c3aed;padding:14px;border-radius:8px">
    <b>🎯 이번 주 단 하나의 실행</b><br>{digest.get('one_move', '')}
  </div>
  <h3>💼 기회 (채용·공모전·앰버서더·지원금)</h3>
  <ul>{opp or '<li style="color:#999">수집된 항목 없음 (NAVER 키 확인)</li>'}</ul>
  <h3>🧠 기술·DB 최신 (Threads)</h3>
  <ul>{tech or '<li style="color:#999">Threads 토큰 없음/결과 없음 — SETUP Lv.5 참고</li>'}</ul>
  <p style="color:#aaa;font-size:.8em">네이버 + Threads 수집 → Gemini 큐레이션 · 과확장 금지</p>
</div>"""


def send(html, today):
    sender = os.environ.get("SENDER_EMAIL")
    pw = os.environ.get("SENDER_PASSWORD")
    to = os.environ.get("RECEIVER_EMAIL", sender)
    if not (sender and pw):
        out = os.path.join(HERE, "radar_preview.html")
        with open(out, "w", encoding="utf-8") as f:
            f.write(html)
        print(f"[radar] 자격증명 없음 → {out}")
        return
    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"📡 neural-flow 레이더 · {today}"
    msg["From"] = f"neural-flow 레이더 <{sender}>"
    msg["To"] = to
    msg.attach(MIMEText(html, "html"))
    try:
        s = smtplib.SMTP("smtp.gmail.com", 587)
        s.starttls()
        s.login(sender, pw)
        s.sendmail(sender, to, msg.as_string())
        s.quit()
        print(f"[radar] 발송 완료 → {to}")
    except Exception as e:
        print(f"[radar] 발송 실패: {e}")


def run():
    today = datetime.now(KST).strftime("%Y-%m-%d")
    print("📡 neural-flow 레이더 시작")
    opps, threads = collect()
    print(f"수집: 기회 {len(opps)} · Threads {len(threads)}")
    digest = curate(opps, threads)
    send(render(digest, today), today)
    print("✅ 완료")


if __name__ == "__main__":
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass
    run()
