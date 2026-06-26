"""
neural-flow Threads 소스 — 공식 Threads API (keyword_search).

준상이 원한 'Threads = 데이터베이스·기술 최신정보의 근원'. THREADS_ACCESS_TOKEN 있을 때만 동작.

⚠️ 정직한 한계: 타인의 '공개글' 키워드 검색에는 `threads_keyword_search` 권한이 필요하고,
이는 Meta App Review(앱 심사) 대상이다. 권한 승인 전에는 인증 사용자(테스터) 본인 글만 검색된다.
토큰 발급·권한은 SETUP.md, 공식 문서: https://developers.facebook.com/docs/threads/keyword-search/
"""

import os
import requests

BASE = "https://graph.threads.net/v1.0"
FIELDS = "id,text,permalink,timestamp,username"


def search(query, limit=8, search_type="RECENT"):
    """키워드로 Threads 게시물 검색. search_type: RECENT | TOP."""
    token = os.environ.get("THREADS_ACCESS_TOKEN")
    if not token:
        return []
    try:
        r = requests.get(
            f"{BASE}/keyword_search",
            params={
                "q": query,
                "search_type": search_type,
                "fields": FIELDS,
                "limit": limit,
                "access_token": token,
            },
            timeout=20,
        )
        r.raise_for_status()
        out = []
        for p in r.json().get("data", []):
            out.append({
                "text": (p.get("text") or "")[:280],
                "username": p.get("username"),
                "permalink": p.get("permalink"),
                "timestamp": p.get("timestamp"),
                "q": query,
            })
        return out
    except Exception as e:
        print(f"[radar] Threads 검색 실패({query}): {e}")
        return []


def pull(keywords, per=4):
    """여러 키워드를 한 번에 수집."""
    items = []
    for kw in keywords:
        items.extend(search(kw, limit=per))
    return items
