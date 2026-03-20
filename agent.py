import os
from langchain_openai import ChatOpenAI, AzureChatOpenAI
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import PromptTemplate
import json

def get_llm():
    """
    Initialize the LLM based on environment variables.
    Supports Google Gemini, standard OpenAI, and Azure OpenAI.
    """
    if os.environ.get("GOOGLE_API_KEY"):
        return ChatGoogleGenerativeAI(
            model=os.environ.get("GEMINI_MODEL", "gemini-2.5-flash"), 
            temperature=0.3
        )
    elif os.environ.get("AZURE_OPENAI_API_KEY") and os.environ.get("AZURE_OPENAI_ENDPOINT"):
        return AzureChatOpenAI(
            azure_deployment=os.environ.get("AZURE_OPENAI_DEPLOYMENT", "gpt-4o"),
            api_version=os.environ.get("AZURE_OPENAI_API_VERSION", "2024-02-15-preview"),
            temperature=0.3
        )
    elif os.environ.get("OPENAI_API_KEY"):
        return ChatOpenAI(
            model=os.environ.get("OPENAI_MODEL", "gpt-4o"),
            temperature=0.3
        )
    else:
        raise ValueError("No valid AI API keys found. Please provide GOOGLE_API_KEY or OPENAI_API_KEY in .env")

def get_dynamic_topics():
    """
    Calls the LLM to ask for 2 current trending dynamic tech/business keywords.
    """
    llm = get_llm()
    prompt = PromptTemplate(
        input_variables=[],
        template='''
지금 가장 뜨겁게 떠오르는 글로벌 비즈니스, 딥테크 트렌드 키워드(분야) 2가지를 제안해주세요.
단, 다음 분야는 제외하세요: [AI, 반도체, 일론머스크, 스페이스X, 테슬라, 기본 거시경제, 창업]
가장 핫한 트렌드(예: 양자컴퓨팅, 기후테크, UAM, 자율주행, 휴머노이드 등) 중 현재 시점에서 가장 중요한 2가지만 콤마(,)로 구분하여 답변하세요. 
설명 없이 오직 단어 2개만 출력하세요 (예: 양자컴퓨팅, 바이오테크).
'''
    )
    try:
        chain = prompt | llm
        response = chain.invoke({})
        content = response.content.strip()
        if "\n" in content:
            content = content.split("\n")[0]
        keywords = [k.strip() for k in content.split(",") if k.strip()]
        return keywords[:2]
    except Exception as e:
        print(f"Error fetching dynamic topics: {e}")
        return []

def master_curate(all_items):
    """
    Master Curator Agent: Takes all collected items across all categories and selects the top 5-7.
    """
    if not all_items:
        return []
        
    llm = get_llm()
    prompt = PromptTemplate(
        input_variables=["items"],
        template='''
당신은 전문 정보 큐레이터입니다. 한국어로 답변하세요.

[사용자 프로필]
- 관심 분야: AI, 노동시장 변화, 부동산, 경제/금융, 혁신 기술, AI 반도체/메모리, 주식/증권, 창업
- 선호 스타일: 단순 요약이 아닌 "분석과 시사점" 중심
- 투자에도 관심이 있으므로, 기술/경제 뉴스의 투자적 함의도 언급

[오늘의 수집 정보]
{items}

[요청]
1. 위 정보 중 오늘 반드시 알아야 할 것 5~7개를 엄선하세요.
2. 각 항목에 대해 다음 키를 가진 JSON 객체로 작성하세요:
   - "title": 뉴스/영상/블로그의 제목 (한 줄)
   - "analysis": AI 분석 (200~400자) - 핵심 내용 + 왜 중요한지 + 시사점
   - "investment_insight": 투자 시사점 (해당 시 작성, 없으면 빈 문자열)
   - "original_link": 원본 링크
   - "category_tag": 카테고리 태그 (예: #AI #부동산 #창업)
3. 중요도 순으로 정렬하여 JSON 배열(Array) 형식으로 응답하세요.

[선별 기준]
- 지금 이 시점에 알아야 하는 것 (적시성)
- 깊이 있는 분석이 가능한 것 (단순 팩트 X)
- 여러 분야에 걸쳐 골고루 (한 분야 편중 X)

응답은 오직 올바른 JSON 배열 형식(```json [ ... ] ```)으로만 출력하세요.
'''
    )
    
    # Format the items into a string
    items_text = ""
    for idx, item in enumerate(all_items):
        title = item.get('title', 'No Title')
        desc = item.get('description', '')
        link = item.get('link', item.get('url', ''))
        source = item.get('source_category', '기타')
        items_text += f"[{idx+1}] [{source}] Title: {title}\nDescription: {desc}\nLink: {link}\n\n"

    try:
        chain = prompt | llm
        response = chain.invoke({"items": items_text})
        
        content = response.content.strip()
        if content.startswith("```json"):
            content = content[7:-3]
        elif content.startswith("```"):
            content = content[3:-3]
            
        final_data = json.loads(content)
        return final_data
    except Exception as e:
        print(f"Error in Master Curator Agent: {e}")
        return []

if __name__ == "__main__":
    pass
