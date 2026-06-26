"""
neural-flow → Telegram 푸시 (선택).

TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID 가 있을 때만 동작.
의존성은 requests 뿐. 토큰 발급은 SETUP.md(BotFather) 참고.

파일명을 'telegram' 이 아니라 'tg' 로 둔 이유: python-telegram-bot 패키지와
import 충돌을 피하기 위해서.
"""

import os
import requests


def send_message(text, parse_mode="HTML"):
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat = os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chat:
        return False
    r = requests.post(
        f"https://api.telegram.org/bot{token}/sendMessage",
        json={
            "chat_id": chat,
            "text": text,
            "parse_mode": parse_mode,
            "disable_web_page_preview": True,
        },
        timeout=20,
    )
    r.raise_for_status()
    return True
