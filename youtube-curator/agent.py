"""
youtube-curator — 유튜브 → 옵시디언 → 노션(GTD) 수집 에이전트
================================================================

neural-flow 와 같은 에이전트 루프 구조:
    1. SENSE    — 링크를 모은다
                  · inbox.json (크롬 확장/수동으로 쌓인 링크)
                  · YT_URLS 환경변수 (repository_dispatch / workflow_dispatch)
                  · 헤르메스 워치리스트 (채널 RSS — API 키 불필요)
    2. THINK    — oEmbed 로 메타데이터를 얻고, Gemini 가 9개 영역·태그·한줄요약으로 분류한다
                  (키 없으면 결정론적 폴백 — 시스템이 죽지 않는다)
    3. ACT      — 옵시디언 마크다운 노트를 vault/ 에 쓰고, 노션 GTD 대시보드에 행을 만든다
    4. REMEMBER — history.json 에 기록해 중복을 막고, inbox 를 비운다

실행:
    python youtube-curator/agent.py                # inbox + 헤르메스 워치리스트 처리
    YT_URLS="https://youtu.be/..." python youtube-curator/agent.py   # 특정 링크만
    python youtube-curator/agent.py --backfill     # 노션의 '(제목 수집 대기)' 행 제목 채우기

필요 환경변수 (전부 선택 — 없으면 해당 단계만 조용히 스킵):
    NOTION_TOKEN     — 노션 GTD 대시보드 동기화
    GOOGLE_API_KEY   — Gemini 분류/요약
    GEMINI_MODEL     — 기본 gemini-2.5-flash
"""

import os
import re
import sys
import json
import html
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CONFIG_PATH = os.path.join(HERE, "config.json")
INBOX_PATH = os.path.join(HERE, "inbox.json")
HISTORY_PATH = os.path.join(HERE, "history.json")
KST = timezone(timedelta(hours=9))

NOTION_API = "https://api.notion.com/v1"
NOTION_HEADERS = {"Notion-Version": "2022-06-28", "Content-Type": "application/json"}
PLACEHOLDER_PREFIX = "(제목 수집 대기)"

VIDEO_ID_PATTERNS = [
    re.compile(r"(?:v=|/embed/|/shorts/|/live/|youtu\.be/)([A-Za-z0-9_-]{11})"),
]


def load_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def extract_video_id(url):
    for pat in VIDEO_ID_PATTERNS:
        m = pat.search(url)
        if m:
            return m.group(1)
    return None


def canonical_url(video_id):
    return f"https://www.youtube.com/watch?v={video_id}"


# ── 1. SENSE ────────────────────────────────────────────────────────────────
def sense(config, history):
    """모든 소스에서 신규 링크를 모은다. 반환: [{url, video_id, source, title?, channel?}]"""
    items, seen = [], set(history.keys())

    def add(url, source, title=None, channel=None):
        vid = extract_video_id(url or "")
        if not vid or vid in seen:
            return
        seen.add(vid)
        items.append({"url": canonical_url(vid), "video_id": vid,
                      "source": source, "title": title, "channel": channel})

    # a) 환경변수 (크롬 확장 → repository_dispatch, 또는 workflow_dispatch 입력)
    for token in re.split(r"[\s,]+", os.environ.get("YT_URLS", "").strip()):
        if token:
            add(token, "확장프로그램")

    # b) inbox.json (수동 추가분)
    for link in load_json(INBOX_PATH, {}).get("links", []):
        add(link.get("url"), link.get("source", "수동"))

    # c) 헤르메스 워치리스트 — 채널 RSS (API 키 불필요)
    hermes = config.get("hermes", {})
    if hermes.get("enabled"):
        for ch in hermes.get("watchlist", []):
            if not ch.get("enabled") or not ch.get("channel_id"):
                continue
            try:
                for v in fetch_channel_rss(ch["channel_id"], hermes.get("max_per_channel", 3)):
                    kw = (ch.get("keywords") or []) + (hermes.get("keywords_global") or [])
                    if kw and not any(k.lower() in v["title"].lower() for k in kw):
                        continue
                    add(v["url"], "헤르메스", title=v["title"], channel=v["channel"])
            except Exception as e:
                print(f"[SENSE] 채널 {ch.get('name', ch['channel_id'])} RSS 실패: {e}")

    print(f"[SENSE] 신규 링크 {len(items)}개")
    return items


def fetch_channel_rss(channel_id, limit):
    r = requests.get("https://www.youtube.com/feeds/videos.xml",
                     params={"channel_id": channel_id}, timeout=20)
    r.raise_for_status()
    ns = {"a": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015"}
    root = ET.fromstring(r.content)
    channel = (root.findtext("a:title", "", ns) or "").strip()
    out = []
    for entry in root.findall("a:entry", ns)[:limit]:
        vid = entry.findtext("yt:videoId", "", ns)
        if vid:
            out.append({"url": canonical_url(vid), "video_id": vid,
                        "title": (entry.findtext("a:title", "", ns) or "").strip(),
                        "channel": channel})
    return out


# ── 2. THINK ────────────────────────────────────────────────────────────────
def enrich(item):
    """oEmbed 로 제목·채널을 채운다 (API 키 불필요). 실패해도 진행."""
    if item.get("title"):
        return item
    try:
        r = requests.get("https://www.youtube.com/oembed",
                         params={"url": item["url"], "format": "json"}, timeout=15)
        r.raise_for_status()
        data = r.json()
        item["title"] = html.unescape(data.get("title", "")) or None
        item["channel"] = item.get("channel") or data.get("author_name")
    except Exception as e:
        print(f"[THINK] oEmbed 실패({item['video_id']}): {e}")
    item["title"] = item.get("title") or f"{PLACEHOLDER_PREFIX} {item['video_id']}"
    return item


def classify(items, config):
    """Gemini 로 영역·태그·한줄요약 분류. 키 없거나 실패하면 빈 값 폴백."""
    key = os.environ.get("GOOGLE_API_KEY")
    if not key or not items:
        return
    model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
    videos = [{"video_id": i["video_id"], "title": i["title"], "channel": i.get("channel") or ""}
              for i in items]
    prompt = (
        "아래 유튜브 영상들을 준상의 삶 9개 영역으로 분류하라.\n"
        f"영역(정확히 이 문자열 중 하나): {json.dumps(config['domains'], ensure_ascii=False)}\n"
        f"영상: {json.dumps(videos, ensure_ascii=False)}\n\n"
        '각 영상에 대해 {"video_id":"", "domain":"", "tags":["짧은 태그 1~3개"], "summary":"제목으로 추정한 한줄"} '
        "형태의 JSON 배열만 출력하라(코드펜스 금지)."
    )
    try:
        r = requests.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            params={"key": key},
            json={"contents": [{"parts": [{"text": prompt}]}]},
            timeout=60,
        )
        r.raise_for_status()
        raw = r.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
        if raw.startswith("```"):
            raw = raw.strip("`").lstrip("json").strip()
        start, end = raw.find("["), raw.rfind("]")
        parsed = {p["video_id"]: p for p in json.loads(raw[start:end + 1])}
        for i in items:
            p = parsed.get(i["video_id"], {})
            if p.get("domain") in config["domains"]:
                i["domain"] = p["domain"]
            i["tags"] = [t for t in (p.get("tags") or []) if t][:3]
            i["summary"] = p.get("summary", "")
        print(f"[THINK] Gemini 분류 완료 ({len(parsed)}개)")
    except Exception as e:
        print(f"[THINK] Gemini 스킵(폴백): {e}")


# ── 3. ACT — 옵시디언 노트 ──────────────────────────────────────────────────
def safe_filename(name, maxlen=60):
    name = re.sub(r'[\\/:*?"<>|#^\[\]]', " ", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name[:maxlen].strip() or "untitled"


def write_note(item, config, today):
    folder = os.path.join(ROOT, config["vault_dir"], config["notes_folder"])
    os.makedirs(folder, exist_ok=True)
    fname = f"{today.strftime('%Y-%m-%d')} {safe_filename(item['title'])}.md"
    path = os.path.join(folder, fname)
    tags = ["youtube"] + [re.sub(r"\s+", "-", t) for t in item.get("tags", [])]
    lines = [
        "---",
        f'title: "{item["title"].replace(chr(34), chr(39))}"',
        f"channel: \"{(item.get('channel') or '').replace(chr(34), chr(39))}\"",
        f"url: {item['url']}",
        f"video_id: {item['video_id']}",
        f"domain: \"{item.get('domain', '')}\"",
        f"tags: [{', '.join(tags)}]",
        "status: inbox",
        f"added: {today.strftime('%Y-%m-%d')}",
        f"source: {item['source']}",
        "---",
        "",
        f"![썸네일](https://i.ytimg.com/vi/{item['video_id']}/hqdefault.jpg)",
        "",
        f"▶️ [영상 보기]({item['url']})",
        "",
        "## 요약",
        item.get("summary", "") or "- ",
        "",
        "## 내 노트",
        "- ",
        "",
        "## 액션 아이템",
        "- [ ] ",
        "",
    ]
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    rel = os.path.relpath(path, ROOT)
    print(f"[ACT] 노트 생성: {rel}")
    return rel


# ── 3. ACT — 노션 동기화 ────────────────────────────────────────────────────
def notion_auth():
    token = os.environ.get("NOTION_TOKEN")
    if not token:
        return None
    return {**NOTION_HEADERS, "Authorization": f"Bearer {token}"}


def notion_find_by_video_id(headers, database_id, video_id):
    r = requests.post(f"{NOTION_API}/databases/{database_id}/query", headers=headers,
                      json={"filter": {"property": "URL", "url": {"contains": video_id}},
                            "page_size": 1}, timeout=30)
    r.raise_for_status()
    results = r.json().get("results", [])
    return results[0] if results else None


def notion_props(item, note_path):
    props = {
        "제목": {"title": [{"text": {"content": item["title"][:200]}}]},
        "URL": {"url": item["url"]},
        "상태": {"select": {"name": "📥 수집됨"}},
        "출처": {"select": {"name": item["source"]}},
    }
    if item.get("channel"):
        props["채널"] = {"rich_text": [{"text": {"content": item["channel"][:200]}}]}
    if item.get("domain"):
        props["영역"] = {"select": {"name": item["domain"]}}
    if item.get("tags"):
        props["태그"] = {"multi_select": [{"name": t[:60]} for t in item["tags"]]}
    if note_path:
        props["옵시디언 노트"] = {"rich_text": [{"text": {"content": note_path}}]}
    return props


def sync_notion(item, note_path, config):
    headers = notion_auth()
    if not headers:
        return
    db = config["notion"]["database_id"]
    try:
        existing = notion_find_by_video_id(headers, db, item["video_id"])
        props = notion_props(item, note_path)
        if existing:
            title = "".join(t.get("plain_text", "") for t in
                            existing["properties"].get("제목", {}).get("title", []))
            if title and not title.startswith(PLACEHOLDER_PREFIX) and not title.startswith("http"):
                props.pop("제목")  # 사람이 고친 제목은 존중
            props.pop("상태", None)  # 기존 행의 진행 상태도 존중
            r = requests.patch(f"{NOTION_API}/pages/{existing['id']}", headers=headers,
                               json={"properties": props}, timeout=30)
        else:
            r = requests.post(f"{NOTION_API}/pages", headers=headers,
                              json={"parent": {"database_id": db}, "properties": props},
                              timeout=30)
        r.raise_for_status()
        print(f"[ACT] 노션 {'갱신' if existing else '생성'}: {item['title'][:40]}")
    except Exception as e:
        print(f"[ACT] 노션 동기화 실패({item['video_id']}): {e}")


def backfill_notion(config):
    """노션에서 '(제목 수집 대기)' 행을 찾아 oEmbed 제목으로 채운다."""
    headers = notion_auth()
    if not headers:
        print("NOTION_TOKEN 없음 — backfill 불가")
        return
    db = config["notion"]["database_id"]
    r = requests.post(f"{NOTION_API}/databases/{db}/query", headers=headers,
                      json={"page_size": 100}, timeout=30)
    r.raise_for_status()
    for page in r.json().get("results", []):
        p = page.get("properties", {})
        title = "".join(t.get("plain_text", "") for t in p.get("제목", {}).get("title", []))
        url = p.get("URL", {}).get("url")
        if not url or not (title.startswith(PLACEHOLDER_PREFIX) or title.startswith("http")):
            continue
        vid = extract_video_id(url)
        if not vid:
            continue
        item = enrich({"url": canonical_url(vid), "video_id": vid, "source": "수동"})
        if item["title"].startswith(PLACEHOLDER_PREFIX):
            continue
        requests.patch(f"{NOTION_API}/pages/{page['id']}", headers=headers, json={
            "properties": {
                "제목": {"title": [{"text": {"content": item["title"][:200]}}]},
                "채널": {"rich_text": [{"text": {"content": (item.get('channel') or '')[:200]}}]},
            }}, timeout=30).raise_for_status()
        print(f"[BACKFILL] {vid} → {item['title'][:40]}")


# ── 4. REMEMBER ─────────────────────────────────────────────────────────────
def remember(items, history, today):
    for i in items:
        history[i["video_id"]] = {
            "title": i["title"], "url": i["url"], "source": i["source"],
            "note": i.get("note_path", ""), "date": today.strftime("%Y-%m-%d"),
        }
    save_json(HISTORY_PATH, history)
    save_json(INBOX_PATH, {"links": []})
    print(f"[REMEMBER] history {len(history)}건 · inbox 비움")


# ── main ────────────────────────────────────────────────────────────────────
def run():
    config = load_json(CONFIG_PATH, {})
    if "--backfill" in sys.argv:
        backfill_notion(config)
        return
    history = load_json(HISTORY_PATH, {})
    today = datetime.now(KST)

    items = sense(config, history)                     # SENSE
    if not items:
        print("✅ 신규 링크 없음 — 종료")
        return
    for item in items:                                 # THINK
        enrich(item)
    classify(items, config)
    for item in items:                                 # ACT
        item["note_path"] = write_note(item, config, today)
        sync_notion(item, item["note_path"], config)
    remember(items, history, today)                    # REMEMBER
    print(f"✅ 완료 — {len(items)}개 수집")


if __name__ == "__main__":
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass
    run()
