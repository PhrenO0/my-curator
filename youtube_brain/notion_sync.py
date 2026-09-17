"""
youtube_brain ↔ Notion 동기화 (선택)
====================================
지식 카드를 노션 '📺 유튜브 지식' 데이터베이스에 페이지로 적재한다(영상 = 한 페이지).
neural-flow/notion_sync.py 와 같은 방식(REST + NOTION_TOKEN, 의존성 requests).

대상 DB 결정 순서:
  1) 환경변수 YT_BRAIN_NOTION_DB
  2) youtube_brain/notion.json 캐시
  3) 노션 검색으로 같은 제목 DB 탐색(중복 생성 방지)
  4) 부모 페이지(YT_BRAIN_NOTION_PARENT, 기본=neural-flow 허브) 아래 자동 생성
중복 적재: '영상ID' 속성으로 페이지를 찾아 있으면 속성 갱신, 없으면 새 페이지 생성.
"""

import os
import json
import requests

from .config import HERE

API = "https://api.notion.com/v1"
NOTION_VERSION = "2022-06-28"
STATE_PATH = os.path.join(HERE, "notion.json")
DB_TITLE = "📺 유튜브 지식"
DEFAULT_PARENT = "38bb9019-0357-819c-aad5-f4877ff8a797"  # neural-flow 허브 페이지(config.json)


def _auth():
    token = os.environ.get("NOTION_TOKEN")
    if not token:
        raise RuntimeError("NOTION_TOKEN 없음")
    return {"Authorization": f"Bearer {token}", "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json"}


def _rt(text, limit=2000):
    """Notion rich_text 배열(2000자 제한 안전)."""
    return [{"type": "text", "text": {"content": (text or "")[:limit]}}]


def _split(text, n=1900):
    return [text[i:i + n] for i in range(0, len(text), n)] or [""]


def _load_state():
    if os.path.exists(STATE_PATH):
        try:
            with open(STATE_PATH, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def _save_state(state):
    try:
        with open(STATE_PATH, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[notion] 상태 저장 실패: {e}")


# ── 대상 DB 확보 ──────────────────────────────────────────────────────────────
def _search_database():
    """같은 제목의 DB 가 이미 있으면 그 id 반환(중복 생성 방지)."""
    r = requests.post(f"{API}/search", headers=_auth(),
                      json={"query": DB_TITLE, "filter": {"property": "object", "value": "database"}},
                      timeout=30)
    r.raise_for_status()
    for res in r.json().get("results", []):
        title = "".join(t.get("plain_text", "") for t in res.get("title", []))
        if title.strip() == DB_TITLE:
            return res["id"]
    return None


def _create_database(parent):
    body = {
        "parent": {"type": "page_id", "page_id": parent},
        "icon": {"type": "emoji", "emoji": "📺"},
        "title": _rt(DB_TITLE),
        "properties": {
            "제목": {"title": {}},
            "카테고리": {"select": {}},
            "채널": {"rich_text": {}},
            "키워드": {"multi_select": {}},
            "한줄요약": {"rich_text": {}},
            "URL": {"url": {}},
            "영상ID": {"rich_text": {}},
            "적재일": {"date": {}},
        },
    }
    r = requests.post(f"{API}/databases", headers=_auth(), json=body, timeout=30)
    r.raise_for_status()
    return r.json()["id"]


def ensure_database():
    db = os.environ.get("YT_BRAIN_NOTION_DB") or _load_state().get("database_id")
    if db:
        return db
    db = _search_database()
    if not db:
        parent = os.environ.get("YT_BRAIN_NOTION_PARENT", DEFAULT_PARENT)
        db = _create_database(parent)
        print(f"[notion] '{DB_TITLE}' DB 생성: {db}")
    state = _load_state()
    state["database_id"] = db
    _save_state(state)
    return db


# ── 페이지 upsert ─────────────────────────────────────────────────────────────
def _find_page(db, video_id):
    r = requests.post(f"{API}/databases/{db}/query", headers=_auth(),
                      json={"filter": {"property": "영상ID", "rich_text": {"equals": video_id}},
                            "page_size": 1}, timeout=30)
    r.raise_for_status()
    res = r.json().get("results", [])
    return res[0]["id"] if res else None


def _props(rec):
    props = {
        "제목": {"title": _rt(rec.get("title") or "(제목 없음)")},
        "카테고리": {"select": {"name": (rec.get("category") or "기타")[:100]}},
        "채널": {"rich_text": _rt(rec.get("channel") or "")},
        # multi_select 옵션명에는 쉼표 금지 → 공백으로 치환
        "키워드": {"multi_select": [
            {"name": k.replace(",", " ").strip()[:100]}
            for k in (rec.get("keywords") or [])[:10] if k and k.strip()
        ]},
        "한줄요약": {"rich_text": _rt(rec.get("one_liner") or "")},
        "URL": {"url": rec.get("url") or None},
        "영상ID": {"rich_text": _rt(rec.get("video_id") or "")},
    }
    if rec.get("created_at"):
        props["적재일"] = {"date": {"start": rec["created_at"][:10]}}
    return props


def _children(rec):
    blocks = []
    if rec.get("one_liner"):
        blocks.append({"object": "block", "type": "callout",
                       "callout": {"rich_text": _rt(rec["one_liner"]),
                                   "icon": {"type": "emoji", "emoji": "💡"}}})

    def section(title, items):
        out = []
        if items:
            out.append({"object": "block", "type": "heading_3", "heading_3": {"rich_text": _rt(title)}})
            for it in items[:12]:
                out.append({"object": "block", "type": "bulleted_list_item",
                            "bulleted_list_item": {"rich_text": _rt(it)}})
        return out

    blocks += section("📌 핵심 요약", rec.get("tl_dr"))
    blocks += section("💼 시사점", rec.get("takeaways"))
    if rec.get("summary"):
        blocks.append({"object": "block", "type": "heading_3", "heading_3": {"rich_text": _rt("📝 요약")}})
        for chunk in _split(rec["summary"]):
            blocks.append({"object": "block", "type": "paragraph", "paragraph": {"rich_text": _rt(chunk)}})
    if rec.get("url"):
        blocks.append({"object": "block", "type": "bookmark", "bookmark": {"url": rec["url"]}})
    return blocks[:100]  # Notion: 요청당 children 최대 100


def upsert_record(db, rec):
    page_id = _find_page(db, rec.get("video_id", ""))
    if page_id:
        requests.patch(f"{API}/pages/{page_id}", headers=_auth(),
                       json={"properties": _props(rec)}, timeout=30).raise_for_status()
        return "updated"
    requests.post(f"{API}/pages", headers=_auth(),
                  json={"parent": {"database_id": db}, "properties": _props(rec),
                        "children": _children(rec)}, timeout=30).raise_for_status()
    return "created"


def sync(records):
    """레코드들을 노션 DB에 적재. 토큰 없으면 조용히 건너뜀."""
    if not os.environ.get("NOTION_TOKEN"):
        print("[notion] NOTION_TOKEN 없음 — 동기화 건너뜀")
        return {"created": 0, "updated": 0, "skipped": len(records)}
    try:
        db = ensure_database()
    except Exception as e:
        print(f"[notion] DB 준비 실패: {e}")
        return {"error": str(e)}
    created = updated = 0
    for rec in records:
        try:
            res = upsert_record(db, rec)
            created += res == "created"
            updated += res == "updated"
        except Exception as e:
            print(f"[notion] 적재 실패({rec.get('video_id')}): {e}")
    print(f"[notion] 동기화 완료 — 생성 {created} · 갱신 {updated} (DB {db})")
    return {"created": created, "updated": updated, "database_id": db}
