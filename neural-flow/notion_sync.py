"""
neural-flow ↔ Notion 라이브 동기화 (선택).

NOTION_TOKEN 이 있을 때만 동작한다. 토큰 발급/공유는 SETUP.md 참고.
의존성은 requests 뿐(이미 requirements 에 있음).
"""

import os
import requests

API = "https://api.notion.com/v1"
HEADERS = {
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
}


def _auth():
    token = os.environ.get("NOTION_TOKEN")
    if not token:
        raise RuntimeError("NOTION_TOKEN 없음")
    return {**HEADERS, "Authorization": f"Bearer {token}"}


def _select(prop):
    return (prop or {}).get("select", {}).get("name") if prop else None


def pull_live_activities(database_id):
    """활동 백로그 DB 를 읽어 agent 가 쓰는 compact 형태로 변환."""
    r = requests.post(f"{API}/databases/{database_id}/query",
                      headers=_auth(), json={"page_size": 100}, timeout=30)
    r.raise_for_status()
    out = []
    for page in r.json().get("results", []):
        p = page.get("properties", {})
        title = "".join(t.get("plain_text", "") for t in p.get("활동명", {}).get("title", []))
        why = "".join(t.get("plain_text", "") for t in p.get("왜(비전연결)", {}).get("rich_text", []))
        date = (p.get("일정", {}).get("date") or {}).get("start")
        out.append({
            "name": title,
            "domain": _select(p.get("영역")),
            "priority": _select(p.get("우선순위")),
            "energy": _select(p.get("에너지")),
            "repeat": _select(p.get("반복")),
            "min": (p.get("예상시간(분)", {}) or {}).get("number"),
            "date": date,
            "status": _select(p.get("상태")),
            "why": why,
        })
    return out


def log_one_thing(hub_page_id, today, brief):
    """허브 페이지 끝에 '오늘의 단 하나'를 한 줄 기록(append, 안전)."""
    wd = ["월", "화", "수", "목", "금", "토", "일"][today.weekday()]
    text = f"{today.strftime('%Y-%m-%d')} ({wd}) ☀️ 오늘의 단 하나 — {brief.get('one_thing','')}"
    body = {
        "children": [{
            "object": "block",
            "type": "to_do",
            "to_do": {
                "checked": False,
                "rich_text": [{"type": "text", "text": {"content": text}}],
            },
        }]
    }
    r = requests.patch(f"{API}/blocks/{hub_page_id}/children",
                       headers=_auth(), json=body, timeout=30)
    r.raise_for_status()
    return True
