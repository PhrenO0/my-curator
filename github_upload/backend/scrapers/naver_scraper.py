import os
import requests
import urllib.parse
from bs4 import BeautifulSoup

def get_naver_news(query, display=5):
    """
    Search Naver News API for the given query.
    """
    client_id = os.environ.get("NAVER_CLIENT_ID")
    client_secret = os.environ.get("NAVER_CLIENT_SECRET")
    
    if not client_id or not client_secret:
        print("Warning: NAVER_CLIENT_ID or NAVER_CLIENT_SECRET not found.")
        return []

    enc_text = urllib.parse.quote(query)
    url = f"https://openapi.naver.com/v1/search/news.json?query={enc_text}&display={display}&sort=sim"
    
    headers = {
        "X-Naver-Client-Id": client_id,
        "X-Naver-Client-Secret": client_secret
    }

    try:
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        data = response.json()
        
        news_items = []
        for item in data.get("items", []):
            # The API returns HTML formatted text (e.g. <b> query </b>). Clean it up.
            title = BeautifulSoup(item["title"], "html.parser").get_text()
            description = BeautifulSoup(item["description"], "html.parser").get_text()
            
            news_items.append({
                "title": title,
                "description": description,
                "link": item["originallink"],
                "pub_date": item["pubDate"]
            })
        return news_items
    except Exception as e:
        print(f"Error fetching Naver news: {e}")
        return []

def get_naver_blog(query, display=5):
    """
    Search Naver Blog API for the given query.
    """
    client_id = os.environ.get("NAVER_CLIENT_ID")
    client_secret = os.environ.get("NAVER_CLIENT_SECRET")
    
    if not client_id or not client_secret:
        return []

    enc_text = urllib.parse.quote(query)
    url = f"https://openapi.naver.com/v1/search/blog.json?query={enc_text}&display={display}&sort=sim"
    
    headers = {
        "X-Naver-Client-Id": client_id,
        "X-Naver-Client-Secret": client_secret
    }

    try:
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        data = response.json()
        
        blog_items = []
        for item in data.get("items", []):
            title = BeautifulSoup(item["title"], "html.parser").get_text()
            description = BeautifulSoup(item["description"], "html.parser").get_text()
            
            blog_items.append({
                "title": "[블로그] " + title,
                "description": description,
                "link": item["link"],
                "pub_date": item.get("postdate", "")
            })
        return blog_items
    except Exception as e:
        print(f"Error fetching Naver blogs: {e}")
        return []

if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    print("Testing Naver API with query '경제':")
    for n in get_naver_news("경제", 2):
        print(n['title'])
