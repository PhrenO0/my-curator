import os
import time
import schedule
import json
from dotenv import load_dotenv

from scrapers import get_youtube_videos, get_naver_news, get_kstartup_announcements, get_stock_summary, get_naver_blog
# Agent Logic
from agent import master_curate, get_dynamic_topics
# Email Sender
from email_sender import generate_html_report, send_email

HISTORY_FILE = "history.json"

def load_history():
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except:
            return []
    return []

def save_history(history):
    with open(HISTORY_FILE, "w", encoding="utf-8") as f:
        # Keep only the last 500 links to prevent the file from growing indefinitely
        json.dump(history[-500:], f, ensure_ascii=False, indent=2)

def run_curator():
    print("="*50)
    print("🚀 Starting Daily Curator Process...")
    print("="*50)
    
    # 1. Stocks
    print("1. Scraping Finance Data...")
    tickers = ["^KS11", "^KQ11", "AAPL", "TSLA", "005930.KS"] # KOSPI, KOSDAQ, Apple, Tesla, Samsung Electronics
    finance_data = get_stock_summary(tickers)
    
    # 2. Startups
    print("2. Scraping K-Startup Announcements...")
    kstartup_data = get_kstartup_announcements()
    
    topics = {
        "AI 및 HBM(반도체) 기술": "AI OR HBM 반도체",
        "일론 머스크 및 혁신 테크": "일론 머스크 기술 OR 스페이스X OR 테슬라",
        "경제 지표 및 부동산 시황": "경제 거시 부동산 트렌드",
        "창업 실무 및 정부 지원금": "청년 창업 지원금 OR K스타트업 OR 1인 창업 팁"
    }

    print("2.5 Checking dynamic hot topics...")
    dynamic_topics = get_dynamic_topics()
    for ds in dynamic_topics:
        topics[f"💡 핫트렌드: {ds}"] = ds
        print(f"   -> Found dynamic topic: {ds}")
        
    # Load sent history to avoid duplicates
    sent_history = set(load_history())

    # 3. Process each topic using News, YouTube, and Blogs
    print("3. Fetching News, YouTube, Blogs...")
    all_raw_items = []
    
    for category, query in topics.items():
        print(f"   -> Scraping Category: {category} (Query: {query})")
        # Fetch raw data
        raw_news = get_naver_news(query, display=7)
        raw_videos = get_youtube_videos(query, max_results=3)
        raw_blogs = []
        if "창업" in category:
            raw_blogs = get_naver_blog(query, display=5)

        for item in (raw_news + raw_videos + raw_blogs):
            link = item.get("link", item.get("url", ""))
            # Deduplicate by skipping items we've already emailed
            if link and link not in sent_history:
                item['source_category'] = category
                all_raw_items.append(item)
                
    print(f"   -> Total raw items collected (excluding duplicates): {len(all_raw_items)}")
            
    # 4. Master Curator Analysis
    print("4. Running Master AI Curator (Analysis & Selection)...")
    curated_results = master_curate(all_raw_items)
            
    # 5. Generate Report
    print("5. Generating HTML Report...")
    html_report = generate_html_report(finance_data, kstartup_data, curated_results)
    
    # Save newly sent items to history
    new_history = list(sent_history)
    for res in curated_results:
        link = res.get("original_link", "")
        if link:
            new_history.append(link)
    save_history(new_history)
    
    # 6. Send Email
    print("6. Dispatching Email...")
    send_email(subject="[나만의 큐레이터] 오늘 꼭 봐야할 경제 & 테크 필수 뉴스 리뷰", html_content=html_report)
    print("="*50)
    print("✅ Curator Process Completed Successfully.")
    print("="*50)


def job():
    run_curator()

if __name__ == "__main__":
    # Load Environment Variables
    load_dotenv()
    
    # For testing, we run it once immediately
    print("Test run starting now...")
    run_curator()
    
    # Optionally, schedule it daily (e.g., at 08:00 AM)
    # print("Setting up daily schedule...")
    # schedule.every().day.at("08:00").do(job)
    # while True:
    #     schedule.run_pending()
    #     time.sleep(60)
