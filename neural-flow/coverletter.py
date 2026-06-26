"""
neural-flow — 멀티에이전트 RAG 자소서 엔진
===========================================
'단일 LLM이 한 번에 쓰기'가 아니라, 2026 트렌드인 검색(RAG) + 멀티에이전트 구조.

파이프라인 (각 단계가 하나의 '에이전트'):
    1. RETRIEVE  — 공고 키워드로 경험 자산 DB(experiences.json)에서 최적 소재를 검색 (RAG)
    2. RESEARCH  — 기업 톤·인재상·핵심가치를 정리 (공고/메모 → 기업 언어)
    3. DRAFT     — 같은 문항을 3가지 각도로 초안 (문제정의형 / 성과·근거형 / 메시지·연출형)
    4. SYNTHESIZE— 가장 강한 뼈대 1개로 통합하고 나머지의 좋은 줄을 접목
    5. DE-AI     — AI 티(상투어·과한 em-dash·'A 아니라 B' 반복·외부사례)를 검열·교정

핵심 원칙(cover-letter-customizer.md와 동일):
    - 경험·숫자 불변. 없는 경험 추가 금지.
    - 기업만의 언어로. 경쟁사에도 쓸 수 있는 문장이면 다시.
    - 상투어 금지(귀사/지원하게 되었습니다/성장하고 싶습니다).
    - 준상의 진짜 목소리(발표문 voice): "저는 ~생각합니다" 주장형, 정직(HITL), 담백.

실행:
    python neural-flow/coverletter.py                  # job_input.json 읽어 실행
    python neural-flow/coverletter.py path/to/job.json
    NEURAL_FLOW_MODE=coverletter python neural-flow/agent.py

입력(job_input.json): job_input.example.json 참고.
환경: GOOGLE_API_KEY(없어도 '작성 재료 키트'까지는 동작), SENDER_EMAIL/PASSWORD(있으면 메일).
"""

import os
import re
import sys
import json
import smtplib
from datetime import datetime, timezone, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

HERE = os.path.dirname(os.path.abspath(__file__))
EXP_PATH = os.path.join(HERE, "experiences.json")
KST = timezone(timedelta(hours=9))

# de-AI: 보이면 무조건 다시 써야 하는 상투어
BANNED = [
    "귀사", "지원하게 되었습니다", "성장하고 싶습니다", "최선을 다하겠습니다",
    "열정을 가지고", "이바지하겠습니다", "임하겠습니다", "기여하고 싶습니다",
]
# de-AI: 본인 경험으로 대체를 검토할 '있어 보이는' 외부 사례
GENERIC_REFS = ["토스", "에어비앤비", "배달의민족", "쿠팡", "당근마켓"]

# 3초안의 서로 다른 각도(에이전트 페르소나)
ANGLES = [
    ("문제정의형", "사용자의 불안·마찰을 먼저 정의하고, 그걸 경험 설계로 어떻게 풀었는지의 흐름. CX형 포지셔닝."),
    ("성과·근거형", "숫자와 근거를 앞세워 신뢰를 주는 흐름. AdGuard식 책임·검증 톤."),
    ("메시지·연출형", "메시지·콘텐츠·팀 연출의 강점을 드러내는 흐름. 사람을 움직인 경험 중심."),
]


# ── 0. 입력 ───────────────────────────────────────────────────────────────────
def load_job(path=None):
    """공고 입력을 읽는다. 없으면 데모(크리엠 예시)로 동작."""
    path = path or os.path.join(HERE, "job_input.json")
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    print(f"[input] {os.path.basename(path)} 없음 → 데모 입력 사용")
    return {
        "company": "(데모) 초기 AI 스타트업",
        "role": "AI 서비스기획 인턴",
        "char_limit": 1000,
        "company_brief": "사용자 경험을 빠르게 실험하는 0→1 제품팀.",
        "questions": ["지원 동기와 본인이 이 직무에 맞는 이유를 서술하시오."],
    }


def load_experiences():
    with open(EXP_PATH, "r", encoding="utf-8") as f:
        return json.load(f)["experiences"]


# ── 1. RETRIEVE (RAG) ─────────────────────────────────────────────────────────
def tokenize(text):
    """한글/영문 토큰화(소문자)."""
    return [t.lower() for t in re.findall(r"[가-힣]+|[a-zA-Z]+", text or "")]


def retrieve(text, exps, k=3, serve_tag=None):
    """공고+문항 텍스트로 경험을 점수화해 top-k 반환 — 어휘 매칭 기반 RAG.

    점수 = 키워드 겹침(×2) + 본문/제목 단어 겹침(×1) + (문항 유형 매칭 보너스).
    임베딩이 없어도 견고하게 동작하는 결정론적 retriever.
    """
    q_tokens = set(tokenize(text))
    scored = []
    for e in exps:
        kw = set(tokenize(" ".join(e.get("keywords", []))))
        body = set(tokenize(e.get("title", "") + " " + e.get("one_liner", "") + " " + e.get("story", "")))
        score = 2 * len(q_tokens & kw) + len(q_tokens & body)
        if serve_tag and serve_tag in e.get("serves", []):
            score += 3
        if score > 0:
            scored.append((score, e))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [e for _, e in scored[:k]]


def question_tag(question):
    """문항 텍스트에서 대략의 유형 태그를 뽑아 retrieval 보너스에 쓴다."""
    q = question
    if any(w in q for w in ["지원", "동기", "이유", "왜"]):
        return "지원동기"
    if any(w in q for w in ["역량", "강점", "직무", "능력", "기여"]):
        return "직무역량"
    if any(w in q for w in ["협업", "팀", "갈등", "소통", "함께"]):
        return "협업"
    if any(w in q for w in ["도전", "어려움", "실패", "극복", "성취"]):
        return "도전"
    if any(w in q for w in ["성격", "장단점", "가치관"]):
        return "성격"
    if any(w in q for w in ["포부", "목표", "비전", "입사 후"]):
        return "포부"
    return None


# ── LLM ───────────────────────────────────────────────────────────────────────
def get_llm(temperature=0.5):
    key = os.environ.get("GOOGLE_API_KEY")
    if not key:
        return None
    from langchain_google_genai import ChatGoogleGenerativeAI
    return ChatGoogleGenerativeAI(
        model=os.environ.get("GEMINI_MODEL", "gemini-2.5-flash"),
        google_api_key=key,
        temperature=temperature,
    )


def _ask(llm, prompt):
    return (llm.invoke(prompt).content or "").strip()


VOICE = (
    "준상의 진짜 문체로 써라: ① 첫 문장은 '저는 ~라고 생각합니다' 같은 담백한 주장 또는 장면으로 "
    "시작하고 바로 경험으로 착지한다(상투적 후킹 금지). ② em-dash 격언('— ...') 남발 금지. "
    "③ 'A가 아니라 B' 대구는 글 전체에서 최대 1번. ④ 정직(HITL) 태도 — 과장·미사여구 대신 "
    "사실과 숫자로. ⑤ 토스·에어비앤비 같은 외부 사례 대신 본인 경험으로만."
)


# ── 2. RESEARCH ───────────────────────────────────────────────────────────────
def research_company(job, llm):
    """공고/메모에서 기업 톤·핵심가치·키워드를 정리(기업 언어 확보)."""
    base = {
        "company": job.get("company", ""),
        "role": job.get("role", ""),
        "keywords": [],
        "tone": job.get("company_brief", ""),
    }
    if llm is None:
        return base
    prompt = f"""다음 기업/공고 정보를 자소서 커스텀에 쓸 수 있게 요약하라.
기업명: {job.get('company','')}
직무: {job.get('role','')}
공고/뉴스/사업방향 메모: {job.get('company_brief','')}

JSON만 출력(코드펜스 금지):
{{"company":"","values":["인재상·핵심가치 2~4개"],"keywords":["이 회사 언어로 녹일 단어 4~6개"],"tone":"이 회사에 맞는 글 톤 한 줄"}}"""
    try:
        return _loads(_ask(llm, prompt)) | {"role": job.get("role", "")}
    except Exception as e:
        print(f"[research] 폴백: {e}")
        return base


# ── 3. DRAFT ──────────────────────────────────────────────────────────────────
def draft(question, char_limit, exps, ctx, angle, llm):
    name, desc = angle
    mats = "\n".join(f"- {e['title']} | {e['one_liner']} | 근거:{e['proof']}" for e in exps)
    prompt = f"""너는 합격 자소서를 10년 컨설팅한 전문가다. 아래 문항에 대한 '{name}' 초안 1개를 써라.
이 각도: {desc}

[기업] {ctx.get('company','')} / 직무 {ctx.get('role','')}
[기업 언어·가치] {json.dumps(ctx.get('values', []), ensure_ascii=False)} {json.dumps(ctx.get('keywords', []), ensure_ascii=False)}
[톤] {ctx.get('tone','')}

[문항] {question}
[글자수] 약 {char_limit}자 (±10%)

[쓸 수 있는 경험 — 숫자·사실 절대 변경 금지, 없는 경험 추가 금지]
{mats}

{VOICE}
상투어 금지: {', '.join(BANNED)}.
초안 본문만 출력(설명·머리말 없이)."""
    if llm is None:
        return None
    return _ask(llm, prompt)


def synthesize(question, char_limit, drafts, ctx, llm):
    """3초안을 한 개의 강한 뼈대로 통합."""
    joined = "\n\n".join(f"[초안 {i+1}]\n{d}" for i, d in enumerate(drafts) if d)
    prompt = f"""아래 3개 초안을 하나로 통합하라. 가장 설득력 있는 뼈대 1개를 고르고,
나머지 초안에서 더 좋은 문장·근거만 접목해 완성도를 높여라. 짜깁기 티가 나면 안 된다.

[문항] {question}
[글자수] 약 {char_limit}자(±10%) — 넘치면 가장 약한 문장부터 줄여라.
[기업 언어] {json.dumps(ctx.get('keywords', []), ensure_ascii=False)}

{joined}

{VOICE}
완성된 최종 본문만 출력."""
    if llm is None:
        return drafts[0] if drafts else ""
    return _ask(llm, prompt)


# ── 5. DE-AI ──────────────────────────────────────────────────────────────────
def de_ai_scan(text):
    """결정론적 AI-티 탐지 — LLM 없이도 도는 검열기. 이슈 리스트 반환."""
    issues = []
    for b in BANNED:
        if b in text:
            issues.append(f"상투어 '{b}' 사용 → 다시 쓸 것")
    dash = text.count("—") + text.count(" - ")
    if dash > 2:
        issues.append(f"em-dash/대시 {dash}회 — 격언투 과다(2회 이하로)")
    anira = len(re.findall(r"[가-힣]\s*(?:이|가)?\s*아니라", text))
    if anira > 1:
        issues.append(f"'A가 아니라 B' 대구 {anira}회 — 글 전체 1회로 제한")
    for g in GENERIC_REFS:
        if g in text:
            issues.append(f"외부 사례 '{g}' 등장 → 본인 경험으로 대체 검토")
    if re.match(r"^\s*저는\b", text) and "생각" not in text[:40]:
        issues.append("첫 문장 '저는'으로 밋밋하게 시작 — 장면/주장으로 후킹 검토")
    # 느낌표·버즈워드 과다
    if text.count("!") >= 2:
        issues.append("느낌표 과다 — 담백하게")
    return issues


def de_ai_rewrite(text, issues, ctx, llm):
    """탐지된 이슈를 준상 voice로 교정."""
    if not issues or llm is None:
        return text
    prompt = f"""아래 자소서 문단에서 다음 'AI 티' 문제만 고쳐라. 내용·경험·숫자는 절대 바꾸지 말고,
표현만 준상의 진짜 목소리로 자연스럽게 교정하라.

[고칠 문제]
{chr(10).join('- ' + i for i in issues)}

[기업 언어 유지] {json.dumps(ctx.get('keywords', []), ensure_ascii=False)}
{VOICE}

[원문]
{text}

교정된 본문만 출력."""
    return _ask(llm, prompt)


# ── 오케스트레이션 ─────────────────────────────────────────────────────────────
def answer_question(question, char_limit, exps, ctx, llm):
    tag = question_tag(question)
    picked = retrieve(question + " " + ctx.get("tone", ""), exps, k=3, serve_tag=tag)
    drafts = [draft(question, char_limit, picked, ctx, a, llm) for a in ANGLES]
    merged = synthesize(question, char_limit, drafts, ctx, llm)
    issues = de_ai_scan(merged or "")
    final = de_ai_rewrite(merged, issues, ctx, llm) if merged else ""
    issues_after = de_ai_scan(final or "")
    return {
        "question": question,
        "tag": tag,
        "used": [e["title"] for e in picked],
        "drafts_n": sum(1 for d in drafts if d),
        "final": final or "",
        "issues_before": issues,
        "issues_after": issues_after,
        "material_kit": picked,  # LLM 없을 때 재료로 노출
    }


def _loads(raw):
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1].lstrip("json").strip() if "```" in raw else raw
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        s, e = raw.find("{"), raw.rfind("}")
        return json.loads(raw[s:e + 1])


# ── 출력 ──────────────────────────────────────────────────────────────────────
def render_md(job, ctx, results, has_llm):
    today = datetime.now(KST).strftime("%Y-%m-%d")
    lines = [
        f"# ✍️ {job.get('company','')} 자소서 — {job.get('role','')}",
        f"> neural-flow RAG 자소서 엔진 · {today} · 글자수 목표 {job.get('char_limit','')}자",
        "",
        f"**기업 언어:** {', '.join(ctx.get('keywords', []) or ['(LLM 키 없어 미수집)'])}",
        "",
    ]
    for i, r in enumerate(results, 1):
        lines += [f"## {i}. {r['question']}",
                  f"*검색된 경험(RAG): {', '.join(r['used']) or '없음'}*  ·  *초안 {r['drafts_n']}개 통합*", ""]
        if has_llm and r["final"]:
            lines += [r["final"], ""]
            if r["issues_after"]:
                lines += ["> ⚠️ 남은 AI-티 점검: " + " / ".join(r["issues_after"]), ""]
            else:
                lines += ["> ✅ AI-티 검열 통과", ""]
        else:
            # LLM 키 없을 때: 바로 쓸 수 있는 '작성 재료 키트'
            lines += ["**📦 작성 재료 키트 (이 경험들로 직접 쓰거나, GOOGLE_API_KEY 넣고 자동생성)**", ""]
            for e in r["material_kit"]:
                lines += [f"- **{e['title']}** — {e['one_liner']}  \n  근거: `{e['proof']}`"]
            lines += ["", f"추천 각도: {ANGLES[0][0]}({ANGLES[0][1]})", ""]
    lines += ["---", "_경험·숫자 불변 · 기업 언어로 · 상투어 금지 · 발표문 voice_"]
    return "\n".join(lines)


def render_html(md):
    body = (md.replace("&", "&amp;").replace("<", "&lt;")
              .replace("\n", "<br>"))
    return (f"<div style=\"font-family:'Apple SD Gothic Neo',sans-serif;max-width:720px;"
            f"margin:auto;padding:24px;color:#222;line-height:1.7\">{body}</div>")


def send_email(subject, html):
    sender = os.environ.get("SENDER_EMAIL")
    pw = os.environ.get("SENDER_PASSWORD")
    to = os.environ.get("RECEIVER_EMAIL", sender)
    if not (sender and pw):
        return False
    msg = MIMEMultipart("alternative")
    msg["Subject"], msg["From"], msg["To"] = subject, f"neural-flow 자소서 <{sender}>", to
    msg.attach(MIMEText(html, "html"))
    try:
        s = smtplib.SMTP("smtp.gmail.com", 587)
        s.starttls()
        s.login(sender, pw)
        s.sendmail(sender, to, msg.as_string())
        s.quit()
        print(f"[ACT] 자소서 초안 발송 → {to}")
        return True
    except Exception as e:
        print(f"[ACT] 메일 실패: {e}")
        return False


# ── main ──────────────────────────────────────────────────────────────────────
def run(job_path=None):
    print("✍️ neural-flow 자소서 엔진 시작")
    job = load_job(job_path)
    exps = load_experiences()
    llm = get_llm()
    has_llm = llm is not None
    print(f"[1·RETRIEVE] 경험 자산 {len(exps)}개 로드 · [2·RESEARCH] 기업 분석 "
          f"({'Gemini' if has_llm else '폴백'})")
    ctx = research_company(job, llm)
    results = []
    for q in job.get("questions", []):
        r = answer_question(q, job.get("char_limit", 1000), exps, ctx, llm)
        print(f"  - '{q[:18]}…' → 검색 {len(r['used'])} · 초안 {r['drafts_n']} · "
              f"검열 {len(r['issues_before'])}→{len(r['issues_after'])}")
        results.append(r)

    md = render_md(job, ctx, results, has_llm)
    out = os.path.join(HERE, "coverletter_output.md")
    with open(out, "w", encoding="utf-8") as f:
        f.write(md)
    print(f"[ACT] 결과 저장 → {out}")
    sent = send_email(f"✍️ {job.get('company','')} 자소서 초안 — neural-flow", render_html(md))
    if not sent:
        print("[ACT] 메일 자격증명 없음 — 파일만 저장")
    print("✅ 완료")
    return out


if __name__ == "__main__":
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass
    run(sys.argv[1] if len(sys.argv) > 1 else None)
