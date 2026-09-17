"""
youtube_brain · 1단계 SENSE — 영상 수집(메타데이터 + 자막)
=========================================================
입력(유튜브 링크 또는 키워드)을 영상 목록으로 풀고, 각 영상의 메타데이터와
자막(스크립트)을 가져온다. **자막이 곧 '영상의 내용'** 이다.

- 링크 : video_id 추출 → 단일 영상 (watch?v= · youtu.be · shorts · embed · live)
- 재생목록: playlist?list=... → 목록 영상 일괄 (YOUTUBE_API_KEY 필요)
- 채널 : /@handle · /channel/UC... · /c/ · /user/ → 최근 업로드 일괄 (YOUTUBE_API_KEY 필요)
- 키워드: YouTube Data API 검색 → 상위 N개 (YOUTUBE_API_KEY 필요)
- 메타  : 키 있으면 Data API(조회수·길이까지), 없으면 oEmbed(제목·채널) — 둘 다 실패해도 진행
- 자막  : youtube-transcript-api(키 불필요). ko→en→기타, 라이브러리 신/구 API 모두 대응.
"""

import os
import re
import requests

from .config import DEFAULT_LANGS

# watch?v=ID · youtu.be/ID · /shorts/ID · /embed/ID · /live/ID · /v/ID  (ID = 11자)
_ID_PATTERNS = [
    re.compile(r"(?:v=|/shorts/|/embed/|/live/|/v/|youtu\.be/)([A-Za-z0-9_-]{11})"),
]


def extract_video_id(s):
    """링크/문자열에서 11자 video_id 추출. 못 찾으면 None."""
    s = (s or "").strip()
    for pat in _ID_PATTERNS:
        m = pat.search(s)
        if m:
            return m.group(1)
    # 맨 ID 만 준 경우 — 단, 11자 영소문자 단어(키워드)를 ID로 오인하지 않도록
    # 실제 video_id 는 거의 항상 대문자/숫자/-/_ 를 포함한다.
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", s) and re.search(r"[A-Z0-9_-]", s):
        return s
    return None


def is_youtube_url(s):
    s = (s or "").lower()
    return "youtube.com" in s or "youtu.be" in s


def extract_playlist_id(s):
    """재생목록 id(list=...). 단, 임시/개인 목록(WL·LL·라디오 RD…)은 제외."""
    m = re.search(r"[?&]list=([A-Za-z0-9_-]+)", s or "")
    if not m:
        return None
    pid = m.group(1)
    if pid in ("WL", "LL") or pid.startswith("RD"):
        return None
    return pid


def extract_channel_ref(s):
    """채널 참조 → (kind, value). kind ∈ {id, handle, user, legacy}."""
    s = (s or "").strip()
    m = re.search(r"/channel/(UC[A-Za-z0-9_-]+)", s)
    if m:
        return ("id", m.group(1))
    m = re.search(r"youtube\.com/@([A-Za-z0-9_.\-]+)", s)
    if m:
        return ("handle", m.group(1))
    m = re.search(r"youtube\.com/user/([^/?#]+)", s)
    if m:
        return ("user", m.group(1))
    m = re.search(r"youtube\.com/c/([^/?#]+)", s)
    if m:
        return ("legacy", m.group(1))
    return None


def resolve_targets(query, max_results=5):
    """입력을 video_id 리스트로 변환. 반환: (ids, mode).
    mode ∈ {link, playlist, channel, url-no-video, search} — 호출부 안내 메시지에 쓴다.
    우선순위: 단일 영상(watch?v=) > 재생목록(playlist?list=) > 채널 > 키워드."""
    vid = extract_video_id(query)
    if vid:
        return [vid], "link"
    pl = extract_playlist_id(query)
    if pl:
        return playlist_video_ids(pl, max_results), "playlist"
    ch = extract_channel_ref(query)
    if ch:
        return channel_video_ids(ch, max_results), "channel"
    if is_youtube_url(query):
        return [], "url-no-video"
    return search_video_ids(query, max_results), "search"


def _yt_client():
    """YouTube Data API 클라이언트(키 없으면 None). 검색·메타·재생목록·채널 공용."""
    api_key = os.environ.get("YOUTUBE_API_KEY")
    if not api_key:
        return None
    try:
        from googleapiclient.discovery import build
        return build("youtube", "v3", developerKey=api_key, cache_discovery=False)
    except Exception as e:
        print(f"[ingest] YouTube 클라이언트 생성 실패: {e}")
        return None


def search_video_ids(query, max_results=5):
    """키워드로 YouTube Data API 검색 → video_id 리스트."""
    yt = _yt_client()
    if not yt:
        print("[ingest] 키워드 검색에는 YOUTUBE_API_KEY 가 필요합니다. (링크 직접 입력은 키 없이 동작)")
        return []
    try:
        resp = yt.search().list(
            part="snippet", q=query, type="video", order="relevance",
            maxResults=max_results, regionCode=os.environ.get("YT_REGION", "KR"),
        ).execute()
        ids = [it["id"]["videoId"] for it in resp.get("items", []) if it.get("id", {}).get("videoId")]
        print(f"[ingest] '{query}' 검색 → {len(ids)}개 영상")
        return ids
    except Exception as e:
        print(f"[ingest] 검색 실패('{query}'): {e}")
        return []


def playlist_video_ids(playlist_id, max_results=5):
    """재생목록 → video_id 리스트(최대 max_results, 페이지네이션)."""
    yt = _yt_client()
    if not yt:
        print("[ingest] 재생목록 열거에는 YOUTUBE_API_KEY 가 필요합니다.")
        return []
    ids, token = [], None
    try:
        while len(ids) < max_results:
            resp = yt.playlistItems().list(
                part="contentDetails", playlistId=playlist_id,
                maxResults=min(50, max_results - len(ids)), pageToken=token,
            ).execute()
            for it in resp.get("items", []):
                vid = it.get("contentDetails", {}).get("videoId")
                if vid:
                    ids.append(vid)
            token = resp.get("nextPageToken")
            if not token:
                break
        ids = ids[:max_results]
        print(f"[ingest] 재생목록 {playlist_id} → {len(ids)}개 영상")
        return ids
    except Exception as e:
        print(f"[ingest] 재생목록 열거 실패({playlist_id}): {e}")
        return []


def _resolve_channel_id(yt, ref):
    kind, val = ref
    try:
        if kind == "id":
            return val
        if kind == "handle":
            r = yt.channels().list(part="id", forHandle=val).execute()
        elif kind == "user":
            r = yt.channels().list(part="id", forUsername=val).execute()
        else:  # legacy /c/이름 → 검색으로 채널 찾기
            r = yt.search().list(part="snippet", q=val, type="channel", maxResults=1).execute()
            items = r.get("items", [])
            return items[0]["snippet"]["channelId"] if items else None
        items = r.get("items", [])
        return items[0]["id"] if items else None
    except Exception as e:
        print(f"[ingest] 채널 ID 해석 실패({ref}): {e}")
        return None


def channel_video_ids(ref, max_results=5):
    """채널 → 업로드 재생목록 → 최근 video_id 리스트."""
    yt = _yt_client()
    if not yt:
        print("[ingest] 채널 열거에는 YOUTUBE_API_KEY 가 필요합니다.")
        return []
    cid = _resolve_channel_id(yt, ref)
    if not cid:
        return []
    try:
        items = yt.channels().list(part="contentDetails", id=cid).execute().get("items", [])
        uploads = items[0]["contentDetails"]["relatedPlaylists"]["uploads"] if items else None
    except Exception as e:
        print(f"[ingest] 채널 업로드 목록 조회 실패({cid}): {e}")
        return []
    return playlist_video_ids(uploads, max_results) if uploads else []


# ── 메타데이터 ────────────────────────────────────────────────────────────────
def _iso8601_to_sec(s):
    """ISO8601 duration(PT1H2M3S) → 초."""
    m = re.fullmatch(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", s or "")
    if not m:
        return 0
    h, mi, se = (int(x) if x else 0 for x in m.groups())
    return h * 3600 + mi * 60 + se


def fetch_metadata(video_id):
    """제목·채널·길이·조회수·설명. Data API 우선, 실패 시 oEmbed(키 불필요)."""
    url = f"https://www.youtube.com/watch?v={video_id}"
    meta = {"video_id": video_id, "url": url, "title": "", "channel": "",
            "published": "", "duration_sec": 0, "views": 0, "description": ""}
    yt = _yt_client()
    if yt:
        try:
            items = yt.videos().list(part="snippet,contentDetails,statistics", id=video_id).execute().get("items", [])
            if items:
                it = items[0]
                sn = it.get("snippet", {})
                meta.update({
                    "title": sn.get("title", ""),
                    "channel": sn.get("channelTitle", ""),
                    "published": sn.get("publishedAt", ""),
                    "description": sn.get("description", ""),
                    "duration_sec": _iso8601_to_sec(it.get("contentDetails", {}).get("duration", "")),
                    "views": int(it.get("statistics", {}).get("viewCount", 0) or 0),
                })
                return meta
        except Exception as e:
            print(f"[ingest] Data API 메타 실패({video_id}) → oEmbed 폴백: {e}")
    try:
        r = requests.get("https://www.youtube.com/oembed",
                         params={"url": url, "format": "json"}, timeout=15)
        if r.ok:
            j = r.json()
            meta["title"] = j.get("title", "")
            meta["channel"] = j.get("author_name", "")
    except Exception as e:
        print(f"[ingest] oEmbed 실패({video_id}): {e}")
    return meta


# ── 자막(스크립트) ───────────────────────────────────────────────────────────
def fetch_transcript(video_id, langs=None):
    """자막 → {text, segments, lang, is_generated} 또는 None.
    youtube-transcript-api 신(1.x fetch/list)·구(get_transcript) API 를 모두 대응."""
    langs = langs or DEFAULT_LANGS
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
    except Exception as e:
        print(f"[ingest] youtube-transcript-api 미설치 → 자막 생략 (pip install youtube-transcript-api): {e}")
        return None
    raw = _fetch_raw(YouTubeTranscriptApi, video_id, langs)
    if not raw or not raw.get("data"):
        return None
    segments = [{"text": d.get("text", ""), "start": d.get("start", 0.0), "duration": d.get("duration", 0.0)}
                for d in raw["data"]]
    text = " ".join(s["text"].replace("\n", " ").strip() for s in segments if s["text"].strip())
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return None
    return {"text": text, "segments": segments, "lang": raw.get("lang", ""), "is_generated": raw.get("is_generated", False)}


def _coerce(fetched):
    """FetchedTranscript/리스트를 [{text,start,duration}] 로 정규화."""
    if hasattr(fetched, "to_raw_data"):
        return fetched.to_raw_data()
    out = []
    for s in fetched:
        if isinstance(s, dict):
            out.append(s)
        else:
            out.append({"text": getattr(s, "text", ""), "start": getattr(s, "start", 0.0),
                        "duration": getattr(s, "duration", 0.0)})
    return out


def _pick_transcript(tlist, langs):
    """TranscriptList 에서 우선 언어 → 없으면 첫 자막."""
    try:
        return tlist.find_transcript(langs)
    except Exception:
        for t in tlist:
            return t
        raise RuntimeError("사용 가능한 자막 없음")


def _from_transcript(t):
    return {"data": _coerce(t.fetch()),
            "lang": getattr(t, "language_code", ""),
            "is_generated": bool(getattr(t, "is_generated", False))}


def _fetch_raw(api_cls, video_id, langs):
    """버전별 4가지 경로를 순서대로 시도, 첫 성공 반환."""
    errors = []
    # 1) 신 API 인스턴스: list → 언어선택 → fetch
    try:
        return _from_transcript(_pick_transcript(api_cls().list(video_id), langs))
    except Exception as e:
        errors.append(f"new.list:{type(e).__name__}")
    # 2) 신 API 인스턴스: fetch(languages=...)
    try:
        fetched = api_cls().fetch(video_id, languages=langs)
        return {"data": _coerce(fetched),
                "lang": getattr(fetched, "language_code", langs[0] if langs else ""),
                "is_generated": bool(getattr(fetched, "is_generated", False))}
    except Exception as e:
        errors.append(f"new.fetch:{type(e).__name__}")
    # 3) 구 API 정적: list_transcripts → 언어선택 → fetch
    try:
        return _from_transcript(_pick_transcript(api_cls.list_transcripts(video_id), langs))
    except Exception as e:
        errors.append(f"old.list:{type(e).__name__}")
    # 4) 구 API 정적: get_transcript
    try:
        return {"data": api_cls.get_transcript(video_id, languages=langs),
                "lang": langs[0] if langs else "", "is_generated": True}
    except Exception as e:
        errors.append(f"old.get:{type(e).__name__}")
    print(f"[ingest] 자막 없음/실패({video_id}): {' | '.join(errors)}")
    return None


# ── 통합 ──────────────────────────────────────────────────────────────────────
def ingest_video(video_id, langs=None):
    """한 영상의 메타 + 자막을 합친 dict 반환(요약 단계 입력)."""
    meta = fetch_metadata(video_id)
    tr = fetch_transcript(video_id, langs)
    meta["transcript_text"] = tr["text"] if tr else ""
    meta["transcript_lang"] = tr["lang"] if tr else ""
    meta["transcript_is_generated"] = bool(tr["is_generated"]) if tr else False
    meta["has_transcript"] = bool(tr and tr["text"])
    return meta
