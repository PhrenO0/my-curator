import os
import json
import urllib.parse
import requests
import yfinance as yf
from bs4 import BeautifulSoup
from googleapiclient.discovery import build
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from datetime import datetime
from langchain_core.prompts import PromptTemplate

HISTORY_FILE = "history.json"

def load_history():
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except: return []
    return []

def save_history(history):
    with open(HISTORY_FILE, "w", encoding="utf-8") as f:
        json.dump(history[-500:], f, ensure_ascii=False, indent=2)

def get_youtube_videos(query, max_results=3):
    api_key = os.environ.get("YOUTUBE_API_KEY")
    if not api_key: return []
    try:
        youtube = build("youtube", "v3", developerKey=api_key, cache_discovery=False)
        request = youtube.search().list(part="snippet", q=query, type="video", order="relevance", maxResults=max_results, regionCode="KR")
        response = request.execute()
        return [{"title": "[유튜브] " + i["snippet"]["title"], "description": i["snippet"]["description"], "link": f"https://www.youtube.com/watch?v={i['id']['videoId']}"} for i in response.get("items", [])]
    except Exception as e: return []

def get_naver_news(query, display=7):
    client_id = os.environ.get("NAVER_CLIENT_ID")
    client_secret = os.environ.get("NAVER_CLIENT_SECRET")
    if not client_id or not client_secret: return []
    url = f"https://openapi.naver.com/v1/search/news.json?query={urllib.parse.quote(query)}&display={display}&sort=sim"
    try:
        response = requests.get(url, headers={"X-Naver-Client-Id": client_id, "X-Naver-Client-Secret": client_secret})
        return [{"title": "[뉴스] " + BeautifulSoup(i["title"], "html.parser").get_text(), "description": BeautifulSoup(i["description"], "html.parser").get_text(), "link": i["link"]} for i in response.json().get("items", [])]
    except: return []

def get_naver_blog(query, display=5):
    client_id = os.environ.get("NAVER_CLIENT_ID")
    client_secret = os.environ.get("NAVER_CLIENT_SECRET")
    if not client_id or not client_secret: return []
    url = f"https://openapi.naver.com/v1/search/blog.json?query={urllib.parse.quote(query)}&display={display}&sort=sim"
    try:
        response = requests.get(url, headers={"X-Naver-Client-Id": client_id, "X-Naver-Client-Secret": client_secret})
        return [{"title": "[블로그] " + BeautifulSoup(i["title"], "html.parser").get_text(), "description": BeautifulSoup(i["description"], "html.parser").get_text(), "link": i["link"]} for i in response.json().get("items", [])]
    except: return []

def get_stock_summary(tickers):
    summary = []
    for ticker in tickers:
        try:
            info = yf.Ticker(ticker).fast_info
            price = info.get("lastPrice", 0)
            prev_close = info.get("previousClose", 1)
            change_percent = ((price - prev_close) / prev_close) * 100 if prev_close else 0
            summary.append({"name": ticker, "price": round(price, 2), "change_percent": round(change_percent, 2), "currency": info.get("currency", "")})
        except: pass
    return summary

def get_llm():
    google_key = os.environ.get("GOOGLE_API_KEY")
    if google_key:
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(model=os.environ.get("GEMINI_MODEL", "gemini-2.5-flash"), google_api_key=google_key, temperature=0.3)
    return None

def get_dynamic_topics():
    llm = get_llm()
    if not llm: return []
    prompt = PromptTemplate(input_variables=[], template="지금 가장 뜨겁게 떠오르는 글로벌 딥테크/비즈니스 트렌드(예: 양자컴퓨팅) 2가지만 콤마로 구분해 답해주세요.")
    try:
        content = (prompt | llm).invoke({}).content.strip().split('\n')[0]
        return [k.strip() for k in content.split(",")][:2]
    except: return []

def master_curate(all_items):
    if not all_items: return []
    llm = get_llm()
    if not llm: return []
    prompt = PromptTemplate(input_variables=["items"], template='''당신은 큐레이터입니다. 한국어로 답변하세요.
[수집 정보]
{items}
위 정보 중 오늘 반드시 알아야 할 5~7개를 엄선해서, 다음 JSON 배열만 출력하세요:
[ {{"title": "제목", "analysis": "분석/시사점", "investment_insight": "투자시사점", "original_link": "링크", "category_tag": "#태그"}} ]''')
    
    items_text = "".join([f"[{i+1}] Title:{item.get('title')}\nDesc:{item.get('description')}\nLink:{item.get('link')}\n\n" for i, item in enumerate(all_items)])
    try:
        content = (prompt | llm).invoke({"items": items_text}).content.strip()
        if content.startswith("```json"): content = content[7:-3]
        elif content.startswith("```"): content = content[3:-3]
        return json.loads(content)
    except: return []

def generate_html_report(finance_data, curated_results):
    html = f"<html><body style='font-family: sans-serif;'><h1 style='color: #2c3e50;'>📈 [나만의 큐레이터] 일일 리포트 ({datetime.now().strftime('%Y-%m-%d')})</h1>"
    html += "<h2>📊 증시 요약</h2><table border='1' cellspacing='0' cellpadding='5'><tr><th>종목</th><th>현재가</th><th>등락률</th></tr>"
    for s in finance_data:
        color = 'red' if s['change_percent'] > 0 else 'blue'
        sign = '+' if s['change_percent'] > 0 else ''
        html += f"<tr><td>{s['name']}</td><td>{s['price']}</td><td style='color:{color}'>{sign}{s['change_percent']}%</td></tr>"
    html += "</table><h2>🔥 핵심 큐레이션</h2>"
    for idx, item in enumerate(curated_results):
        html += f"<div><h3 style='margin-bottom:2px;'><a href='{item.get('original_link','#')}'>{idx+1}. {item.get('title')}</a></h3>"
        html += f"<span style='color:purple; font-weight:bold;'>{item.get('category_tag','')}</span>"
        html += f"<p>💡 <b>분석:</b> {item.get('analysis','')}</p>"
        if item.get("investment_insight"): html += f"<p style='background:#f1c40f22; padding:5px;'>💰 <b>투자 시사점:</b> {item.get('investment_insight')}</p>"
        html += "</div><hr/>"
    html += "</body></html>"
    return html

def archive_to_knowledge(curated, max_videos=5):
    """큐레이션에 뽑힌 유튜브 영상을 youtube_brain 지식DB에 자동 적재(선택·안전).
    YT_BRAIN_ARCHIVE=0 으로 끌 수 있고, 실패해도 큐레이터 본류는 멈추지 않는다."""
    if os.environ.get("YT_BRAIN_ARCHIVE", "1").lower() in ("0", "false", "no"):
        return
    links = [c.get("original_link", "") for c in curated
             if "youtube.com" in c.get("original_link", "") or "youtu.be" in c.get("original_link", "")]
    links = links[:max_videos]
    if not links:
        return
    try:
        from youtube_brain.pipeline import ingest_target
    except Exception as e:
        print(f"[curator] youtube_brain 임포트 실패 — 지식 적재 건너뜀: {e}")
        return
    print(f"[curator] 큐레이션된 유튜브 {len(links)}개를 지식DB에 적재…")
    for link in links:
        try:
            ingest_target(link)
        except Exception as e:
            print(f"[curator] 적재 실패({link}): {e}")


def run_curator():
    print("🚀 Starting Daily Curator Process...")
    finance_data = get_stock_summary(["^KS11", "^KQ11", "AAPL", "TSLA", "005930.KS"])
    topics = {"AI/반도체": "AI OR HBM", "혁신테크": "일론머스크 OR 테슬라", "경제": "경제 부동산", "창업": "창업 실무"}
    for ds in get_dynamic_topics(): topics[f"트렌드:{ds}"] = ds
        
    sent_history = set(load_history())
    all_raw_items = []
    
    for category, query in topics.items():
        for item in get_naver_news(query) + get_youtube_videos(query) + (get_naver_blog(query) if "창업" in category else []):
            url = item.get("link", "")
            if url and url not in sent_history: all_raw_items.append(item)
                
    curated = master_curate(all_raw_items)
    report = generate_html_report(finance_data, curated)
    
    new_hist = list(sent_history)
    for c in curated:
        if c.get("original_link"): new_hist.append(c["original_link"])
    save_history(new_hist)

    # 큐레이션된 유튜브 영상을 '내 지식'으로 자동 축적
    archive_to_knowledge(curated)

    sender = os.environ.get("SENDER_EMAIL")
    password = os.environ.get("SENDER_PASSWORD")
    if sender and password:
        msg = MIMEMultipart()
        msg['From'], msg['To'], msg['Subject'] = sender, sender, "[나만의 큐레이터] 일일 최신 리포트 발송"
        msg.attach(MIMEText(report, 'html'))
        try:
            server = smtplib.SMTP('smtp.gmail.com', 587)
            server.starttls()
            server.login(sender, password)
            server.sendmail(sender, sender, msg.as_string())
            server.quit()
        except Exception as e: print(f"Email Error: {e}")
    print("✅ Completed.")

if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    run_curator()
