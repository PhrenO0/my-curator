import requests
from bs4 import BeautifulSoup

def get_kstartup_announcements():
    """
    Scrape the latest announcements from K-Startup.
    Since K-Startup might use dynamic JS, a basic BeautifulSoup approach might need refinement.
    This acts as a placeholder/basic implementation for the K-Startup notice board.
    """
    url = "https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do"
    # Note: K-startup may block simple requests or require a specific user-agent/headers.
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    }
    
    try:
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.text, "html.parser")
        
        # This selector is highly dependent on K-startup's current HTML structure
        # Just extracting basic titles if possible (will likely need updates)
        notices = []
        items = soup.find_all("li", class_="b-list-box") # example placeholder class
        
        for item in items[:5]:
            title_tag = item.find("a", class_="tit")
            if title_tag:
                title = title_tag.get_text(strip=True)
                link = title_tag.get("href")
                notices.append({
                    "title": title,
                    "link": f"https://www.k-startup.go.kr{link}" if link.startswith('/') else link,
                    "source": "K-Startup"
                })
        
        if not notices:
            print("Note: K-Startup website might require Selenium/Playwright or the HTML structure changed.")
            return [{"title": "[Placeholder] Check K-Startup directly for updates.", "link": url, "source": "K-Startup"}]
            
        return notices
    except Exception as e:
        print(f"Error scraping K-startup: {e}")
        return []

if __name__ == "__main__":
    print("Testing K-Startup scraper:")
    for a in get_kstartup_announcements():
        print(a['title'])
