"""
neural-flow 기회·정보 레이더
============================
준상이 안 찾아다녀도 매주 '기회 + 기술/DB 최신정보'가 알아서 오게.

소스:
  - 한국 기회(채용·공모전·앰버서더·지원금): Naver 검색 API
  - 기술·DB 최신정보(1차 신호): Threads + GitHub Trending + Hacker News + RSS
처리: Gemini가 준상 프로필에 맞춰 큐레이션 → 이메일.

실행:  python neural-flow/radar.py
환경:  NAVER_CLIENT_ID/SECRET, GOOGLE_API_KEY, SENDER_EMAIL/PASSWORD
선택:  THREADS_ACCESS_TOKEN(Threads 레이더), RECEIVER_EMAIL, GEMINI_MODEL
       GitHub/HN/RSS는 키 없이 동작(공개 API/HTML). 실패하면 조용히 스킵.
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
# v3 전략(콘텐츠/크리에이터×AI · AI 서비스기획/PM·BD · 창업)에 맞춘 기회 쿼리.
# 링커리어 우회: 링커리어는 봇 차단(403)이라 직접 못 긁지만, 네이버가 링커리어를
# 색인하므로 네이버 검색 API로 링커리어 공고가 우회 수집된다.
OPP_QUERIES = [
    # 1차 도메인: 콘텐츠/크리에이터 × AI
    "생성형 AI 영상 콘텐츠 공모전 접수",
    "AI 공모전 대학생 마감 상금",
    # 대외활동·앰버서더 (AI 브랜드 — 콘텐츠·네트워크)
    "대학생 AI 앰버서더 서포터즈 모집",
    "구글 네이버 카카오 대학생 앰버서더 모집",
    # 직무: AI 서비스기획/PM · BD · 그로스
    "AI 서비스기획 체험형 인턴 모집",
    "사업개발 BD 제휴 인턴 대학생",
    "그로스 마케터 콘텐츠 인턴 스타트업",
    # 창업 트랙
    "대학생 예비창업 지원사업 모집",
    # 산학협력
    "산학협력 현장실습 인턴 모집",
    # 링커리어 우회(네이버 인덱스 경유)
    "링커리어 인턴 공모전 AI 콘텐츠",
]
# 'Threads = 기술/DB 최신정보의 근원'
TECH_KEYWORDS = ["vector database", "RAG", "AI agent", "LLM", "데이터베이스", "프롬프트 엔지니어링"]
# HN 필터용 영문 키워드(제목 매칭)
TECH_KEYWORDS_EN = ["ai", "llm", "rag", "agent", "vector", "database", "product", "prompt"]
# RSS 1차 신호 소스 (이름, URL). 안정적인 피드 위주 — 여기에 추가만 하면 레이더에 잡힌다.
RSS_FEEDS = [
    ("GitHub Blog", "https://github.blog/feed/"),
    ("Smashing", "https://www.smashingmagazine.com/feed/"),
]


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


# ── 기술·DB 1차 신호 (Threads 외) ────────────────────────────────────────────
def github_trending(limit=5):
    """GitHub Trending(daily)을 HTML 파싱. 키 불필요."""
    try:
        from bs4 import BeautifulSoup
        r = requests.get(
            "https://github.com/trending?since=daily",
            headers={"User-Agent": "Mozilla/5.0"}, timeout=15,
        )
        soup = BeautifulSoup(r.text, "html.parser")
        out = []
        for art in soup.select("article.Box-row")[:limit]:
            a = art.select_one("h2 a")
            if not a:
                continue
            repo = " ".join(a.get_text().split())
            desc_el = art.select_one("p")
            desc = desc_el.get_text(strip=True) if desc_el else ""
            out.append({"text": f"[GitHub Trending] {repo} — {desc}",
                        "username": "github/trending",
                        "link": "https://github.com" + a.get("href", "")})
        return out
    except Exception as e:
        print(f"[radar] GitHub trending 스킵: {e}")
        return []


def hackernews_top(keywords, limit=4, scan=30):
    """Hacker News 공식 API에서 상위글 중 키워드 매칭 제목만. 키 불필요."""
    try:
        ids = requests.get(
            "https://hacker-news.firebaseio.com/v0/topstories.json", timeout=15
        ).json()[:scan]
        out = []
        for i in ids:
            if len(out) >= limit:
                break
            it = requests.get(
                f"https://hacker-news.firebaseio.com/v0/item/{i}.json", timeout=10
            ).json() or {}
            title = it.get("title", "")
            if not title:
                continue
            if keywords and not any(k in title.lower() for k in keywords):
                continue
            out.append({"text": f"[HN] {title}", "username": "news.ycombinator",
                        "link": it.get("url") or f"https://news.ycombinator.com/item?id={i}"})
        return out
    except Exception as e:
        print(f"[radar] HN 스킵: {e}")
        return []


def rss_pull(feeds, per=2):
    """RSS 피드에서 최신 항목. 표준 xml.etree로 파싱(추가 의존성 없음)."""
    import xml.etree.ElementTree as ET
    out = []
    for name, url in feeds:
        try:
            r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=15)
            root = ET.fromstring(r.content)
            for it in root.findall(".//item")[:per]:
                title = (it.findtext("title") or "").strip()
                link = (it.findtext("link") or "").strip()
                if title:
                    out.append({"text": f"[{name}] {title}", "username": name, "link": link})
        except Exception as e:
            print(f"[radar] RSS 스킵({name}): {e}")
    return out


def tech_signals():
    """GitHub·HN·RSS 1차 신호를 Threads와 같은 형태로 합친다."""
    return github_trending(5) + hackernews_top(TECH_KEYWORDS_EN, 4) + rss_pull(RSS_FEEDS, 2)


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
    threads += tech_signals()   # GitHub·HN·RSS 추가 (정보 파이프 고도화)
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
    # 폴백(키 없음/무효/오류 공통) — 원본 상위 항목 그대로.
    fallback = {
        "opportunities": [
            {"title": o["title"], "why": o["q"], "link": o["link"]} for o in opps[:7]
        ],
        "tech": [
            {"summary": t["text"], "source": t.get("username", "")} for t in threads[:5]
        ],
        "one_move": "Gemini 폴백 — 원본 상위 항목.",
    }
    if llm is None:
        return fallback
    prompt = f"""너는 준상의 커리어 멘토 'neural-flow 레이더'다.
준상: CX형 AI 서비스기획·콘텐츠×AI 메이커 지망(창업 목적). 1차=콘텐츠/크리에이터×AI,
2차=공간×AI(부동산 복수전공). 직무는 AI 서비스기획/PM·BD. 약점은 과확장 → 적게, 정확히.

아래 원본에서 '지금 준상에게 가치 있는' 것만 골라 큐레이션하라.

[기회 원본 — 공모전·인턴·BD·창업·산학]
{json.dumps(opps[:30], ensure_ascii=False)[:6000]}

[기술·DB 최신(Threads·GitHub Trending·Hacker News·RSS)]
{json.dumps(threads[:24], ensure_ascii=False)[:5000]}

JSON만 출력(코드펜스 금지):
{{"opportunities":[{{"title":"","why":"준상에게 왜 중요한지 한 줄","link":""}}],
  "tech":[{{"summary":"기술/DB 핵심 한 줄","source":"username 또는 permalink"}}],
  "one_move":"이번 주 단 하나의 실행 추천"}}
기회 5~7개·기술 3~5개. 중요도순. 과확장 금지."""
    try:
        raw = (llm.invoke(prompt).content or "").strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1].lstrip("json").strip() if "```" in raw else raw
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            s, e = raw.find("{"), raw.rfind("}")
            return json.loads(raw[s : e + 1])
    except Exception as ex:
        print(f"[radar] 큐레이션 LLM 실패 → 원본 폴백: {ex}")
        return fallback


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
