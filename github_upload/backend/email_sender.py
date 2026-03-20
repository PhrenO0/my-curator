import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from datetime import datetime

def generate_html_report(finance_data, kstartup_data, curated_results):
    """
    Generate a beautiful HTML email report from the curated data.
    """
    today_str = datetime.now().strftime("%Y년 %m월 %d일")
    
    html = f"""
    <html>
    <head>
        <style>
            body {{ font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif; background-color: #f4f7f6; color: #333; margin: 0; padding: 20px; }}
            .container {{ max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }}
            h1 {{ color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px; }}
            h2 {{ color: #34495e; margin-top: 30px; }}
            .item-card {{ background: #fdfdfd; border: 1px solid #eee; border-left: 4px solid #3498db; margin: 15px 0; padding: 15px; border-radius: 6px; }}
            .item-title {{ font-size: 1.1em; font-weight: bold; margin-bottom: 10px; }}
            .item-title a {{ color: #2980b9; text-decoration: none; }}
            .item-title a:hover {{ text-decoration: underline; }}
            .summary {{ color: #555; line-height: 1.5; }}
            .score {{ display: inline-block; background: #e74c3c; color: white; padding: 3px 8px; border-radius: 12px; font-size: 0.85em; font-weight: bold; margin-bottom: 10px; }}
            .tags {{ color: #7f8c8d; font-size: 0.9em; }}
            .finance-table {{ width: 100%; border-collapse: collapse; margin-top: 15px; }}
            .finance-table th, .finance-table td {{ border: 1px solid #ddd; padding: 8px; text-align: left; }}
            .finance-table th {{ background-color: #f2f2f2; }}
            .positive {{ color: #27ae60; font-weight: bold; }}
            .negative {{ color: #c0392b; font-weight: bold; }}
        </style>
    </head>
    <body>
        <div class="container">
            <h1>세상의 유익한 정보: 나만의 큐레이터 보고서</h1>
            <p><strong>생성일: {today_str}</strong></p>
            <p>다중 에이전트(Analyzer & Validator) 교차 검증을 거친 오늘의 핵심 정보 요약입니다.</p>

            <h2>📈 글로벌/국내 주요 지수 요약</h2>
            <table class="finance-table">
                <tr><th>지수/종목</th><th>현재가</th><th>등락률</th></tr>
    """
    
    for s in finance_data:
        color_class = "positive" if s['change_percent'] > 0 else "negative" if s['change_percent'] < 0 else ""
        sign = "+" if s['change_percent'] > 0 else ""
        html += f"<tr><td>{s['name']}</td><td>{s['price']} {s['currency']}</td><td class='{color_class}'>{sign}{s['change_percent']}%</td></tr>"
    html += "</table>"
    
    html += "<h2>🔥 오늘의 핵심 분석 & 시사점 (AI 큐레이션)</h2>"
    if not curated_results:
        html += "<p>오늘 수집된 특별한 핵심 정보가 없습니다.</p>"
        
    for idx, item in enumerate(curated_results):
        link = item.get("original_link", "#")
        title = item.get("title", "제목 없음")
        analysis = item.get("analysis", "요약 없음")
        invest_insight = item.get("investment_insight", "")
        tags = item.get("category_tag", "")
        
        html += f"""
        <div class="item-card">
            <div class="tags" style="color: #8e44ad; font-weight: bold; margin-bottom: 5px;">{tags}</div>
            <div class="item-title"><a href="{link}" target="_blank">{idx+1}. {title}</a></div>
            <div class="summary"><strong>💡 AI 분석 및 시사점:</strong><br/>{analysis}</div>
        """
        if invest_insight:
             html += f'<div class="summary" style="margin-top: 10px; background-color: #f1c40f22; padding: 10px; border-radius: 4px;"><strong>💰 투자 시사점:</strong><br/>{invest_insight}</div>'
        html += "</div>"
            
    html += f"<h2>🚀 오늘 뜨는 K-Startup 공고</h2>"
    if kstartup_data:
        html += "<ul>"
        for a in kstartup_data:
            html += f"<li><a href='{a['link']}' target='_blank'>{a['title']}</a></li>"
        html += "</ul>"
    else:
        html += "<p>수집된 공고가 없습니다.</p>"
        
    html += """
            <br/><hr/><br/>
            <p style="text-align:center; color:#95a5a6; font-size:0.8em;">본 보고서는 AI가 작성한 것으로, 내용의 정확성은 원문 링크에서 확인해주세요.</p>
        </div>
    </body>
    </html>
    """
    return html

def send_email(subject, html_content):
    sender_email = os.environ.get("SENDER_EMAIL")
    sender_password = os.environ.get("SENDER_APP_PASSWORD")
    receiver_email = os.environ.get("RECEIVER_EMAIL", "jun1234sang@gmail.com")
    
    if not sender_email or not sender_password:
        print("Error: SENDER_EMAIL or SENDER_APP_PASSWORD missing. Cannot send email.")
        # For demonstration purposes, print to HTML file instead of crashing out fully.
        with open("test_report.html", "w", encoding="utf-8") as f:
            f.write(html_content)
        print("Report saved locally to test_report.html due to missing email credentials.")
        return
        
    msg = MIMEMultipart('alternative')
    msg['Subject'] = subject
    msg['From'] = f"나만의 큐레이터 <{sender_email}>"
    msg['To'] = receiver_email
    
    part = MIMEText(html_content, 'html')
    msg.attach(part)
    
    try:
        # Use Outlook/Gmail SMTP as appropriate
        smtp_server = "smtp.gmail.com"
        port = 587
        
        server = smtplib.SMTP(smtp_server, port)
        server.starttls()
        server.login(sender_email, sender_password)
        server.sendmail(sender_email, receiver_email, msg.as_string())
        server.quit()
        print(f"Daily report successfully sent to {receiver_email}.")
    except Exception as e:
        print(f"Error sending email: {e}")
        with open("test_report.html", "w", encoding="utf-8") as f:
            f.write(html_content)

if __name__ == "__main__":
    test_html = generate_html_report([{"name": "KOSPI", "price": 2700, "currency": "KRW", "change_percent": 1.2}], [], {"테스트": []})
    print(test_html[:200])
