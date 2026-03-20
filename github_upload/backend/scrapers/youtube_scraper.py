import os
from googleapiclient.discovery import build

def get_youtube_videos(query, max_results=5):
    """
    Search YouTube for a specific query and return the top videos.
    """
    api_key = os.environ.get("YOUTUBE_API_KEY")
    if not api_key:
        print("Warning: YOUTUBE_API_KEY not found in environment variables.")
        return []

    try:
        youtube = build("youtube", "v3", developerKey=api_key)
        
        request = youtube.search().list(
            part="snippet",
            q=query,
            type="video",
            order="relevance",
            maxResults=max_results,
            regionCode="KR"
        )
        response = request.execute()

        videos = []
        for item in response.get("items", []):
            videos.append({
                "title": item["snippet"]["title"],
                "description": item["snippet"]["description"],
                "channel_title": item["snippet"]["channelTitle"],
                "video_id": item["id"]["videoId"],
                "url": f"https://www.youtube.com/watch?v={item['id']['videoId']}"
            })
        return videos
    except Exception as e:
        print(f"Error fetching YouTube data: {e}")
        return []

if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    print("Testing YouTube API with query 'AI':")
    for v in get_youtube_videos("AI", 2):
        print(v['title'])
