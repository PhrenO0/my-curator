"""
neural-flow Gmail 센서 (선택) — SENSE 레이어 확장.

받은 메일에서 '면접·마감·지원·합격·인턴' 신호를 읽어 브리핑에 '챙길 것'으로 띄운다.
OAuth 자격증명(읽기 전용)이 있을 때만 동작. 없으면 빈 리스트(graceful).

필요 환경변수:
    GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
발급법은 SETUP.md 참고. 스코프는 gmail.readonly (읽기 전용)만.
"""

import os

QUERY = "newer_than:7d (면접 OR 마감 OR 지원 OR 합격 OR 서류 OR 인턴 OR 자소서)"


def pull_inbox_flags(max_items=5):
    cid = os.environ.get("GMAIL_CLIENT_ID")
    csec = os.environ.get("GMAIL_CLIENT_SECRET")
    rtok = os.environ.get("GMAIL_REFRESH_TOKEN")
    if not (cid and csec and rtok):
        return []
    try:
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build
    except Exception:
        return []  # google-auth 미설치

    creds = Credentials(
        token=None,
        refresh_token=rtok,
        client_id=cid,
        client_secret=csec,
        token_uri="https://oauth2.googleapis.com/token",
        scopes=["https://www.googleapis.com/auth/gmail.readonly"],
    )
    try:
        svc = build("gmail", "v1", credentials=creds, cache_discovery=False)
        listed = (
            svc.users()
            .messages()
            .list(userId="me", q=QUERY, maxResults=max_items)
            .execute()
        )
        flags = []
        for m in listed.get("messages", []):
            meta = (
                svc.users()
                .messages()
                .get(userId="me", id=m["id"], format="metadata",
                     metadataHeaders=["Subject"])
                .execute()
            )
            for h in meta.get("payload", {}).get("headers", []):
                if h.get("name") == "Subject":
                    flags.append(h["value"][:80])
        return flags
    except Exception as e:
        print(f"[SENSE] Gmail 센서 실패: {e}")
        return []
