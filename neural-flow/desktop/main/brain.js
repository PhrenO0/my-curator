// THINK — agent.py 의 think() 를 옮긴 것 + 영어 회화 브리핑 + 뉴스 요약.
// LLM(Gemini·Claude Code)이 없거나 호출이 실패해도 결정론적 폴백으로 항상 결과를 낸다 (앱이 죽지 않게).

const A = require('../renderer/shared/agenda.js')
const { ENGLISH_FALLBACK } = require('./english-fallback.js')

const { callJson, providerOf, ready } = require('./llm.js')

// ── 데일리/위클리 브리핑 ──────────────────────────────────────────────────────
function balance(profile, activities) {
  const counts = {}
  for (const d of profile.domains || []) counts[d.name] = 0
  for (const a of activities) if (a.domain in counts) counts[a.domain] += 1
  const weakest = Object.entries(counts)
    .sort((x, y) => x[1] - y[1])
    .slice(0, 2)
    .map(([k]) => k)
  return { counts, weakest }
}

function buildBriefPrompt(data, today, mode, todayAgenda, deadlines) {
  const v = data.profile.vision || {}
  const { counts, weakest } = balance(data.profile, data.activities)
  const open = data.activities.filter((a) => a.status !== '완료' && a.status !== '보류')
  const recent = data.history.slice(-7)
  const extra =
    mode === 'weekly'
      ? `\n[주간 모드] 추가로 'recommendations' 배열에 다음 주 활동 3~5개를 제안하라 (각: name, domain, why, priority, energy, min). domain 은 9개 영역 이름 중 하나를 그대로 써라. 특히 가장 비어있는 영역을 채워라.\n`
      : ''
  return `너는 ${data.settings.userName}의 이상적인 삶 멘토 'neural-flow'다. 단순 비서가 아니라 비전에서 역산해 오늘을 설계하는 코치다.

[비전]
- 중심축: ${v.core_axis || ''}
- North Star: ${v.north_star || ''}
- 약점/처방: ${v.weakness || ''}
- 신앙: ${v.faith || ''}

[목표] ${JSON.stringify(data.profile.goals || {})}

[오늘] ${today} (${A.WEEKDAYS[A.weekday(today)]})
[오늘 캘린더] ${JSON.stringify(todayAgenda.map((o) => ({ time: o.start || '종일', title: o.title })))}
[마감 카운트다운] ${JSON.stringify(deadlines.map((d) => ({ title: d.title, date: d.date, d: d.d })))}
[9개 영역 활동 분포] ${JSON.stringify(counts)}
[가장 비어있는 영역] ${JSON.stringify(weakest)}
[최근 7일 '단 하나' 실행 기록] ${JSON.stringify(recent)}
[미완료 활동] ${JSON.stringify(open.slice(0, 30))}
${extra}
원칙: 과확장 금지. '오늘의 단 하나'는 무조건 1개. 마감 임박 > 고가치 > 영성 순. 신앙은 진지하게. 오늘 캘린더에 이미 잡힌 시간을 고려하라.

아래 JSON 만 출력하라:
{
  "greeting": "한 문장 인사(현재의 거룩=집중 상태를 일깨우는)",
  "one_thing": "오늘 반드시 끝낼 핵심 행동 1개",
  "one_thing_why": "그게 왜 오늘인지 + North Star/거룩과의 연결 한 줄",
  "holiness_line": "오늘의 거룩 한 줄(기도/말씀/다짐)",
  "stuck_coaching": "가장 비어있는 영역에 대한 부드러운 코칭 한 줄",
  "trend": "AI·마케팅 트렌드 한 줄(커리어에 도움, 없으면 빈 문자열)"${mode === 'weekly' ? ',\n  "recommendations": [{"name":"","domain":"","why":"","priority":"중간","energy":"가벼움","min":30}]' : ''}
}`
}

// 규칙: 가장 가까운 마감 → 오늘 이후(또는 날짜 없는) 미완료 활동 중 우선순위 높은 순 → 기본 문구
const PRIORITY = { 높음: 0, 중간: 1, 낮음: 2 }
function fallbackBrief(data, today, deadlines) {
  const { weakest } = balance(data.profile, data.activities)
  const dl = deadlines.find((d) => d.d >= 0)
  const open = data.activities
    // 매일 반복하는 루틴은 '단 하나' 후보에서 뺀다 (캘린더 앵커가 따로 챙김)
    .filter((a) => a.status !== '완료' && a.status !== '보류' && (!a.date || a.date >= today) && a.repeat !== '매일' && a.energy !== '루틴')
    .sort((x, y) => (PRIORITY[x.priority] ?? 1) - (PRIORITY[y.priority] ?? 1) || String(x.date || '9').localeCompare(String(y.date || '9')))
  const oneThing = dl?.title || open[0]?.name || '오늘 반드시 끝낼 핵심 1개를 정한다'
  const why = dl
    ? `${A.dLabel(dl.d)} 마감이라 오늘 가장 먼저 챙길 일이에요.`
    : open[0]
      ? `${open[0].why || '우선순위가 가장 높은 미완료 활동이에요.'}`
      : '할 일이 비어 있어요. 활동 보드에서 이번 주 활동을 골라 보세요.'
  return {
    greeting: '지금 이 순간의 거룩=집중 상태로 하루를 연다.',
    one_thing: oneThing,
    one_thing_why: why,
    holiness_line: '여호와를 경외하는 것이 지혜의 근본이요 (잠 9:10)',
    stuck_coaching: weakest.length ? `가장 비어있는 영역: ${weakest.join(', ')} — 작게 한 걸음.` : '',
    trend: '',
  }
}

async function makeBrief(data, llm, { today, mode, todayAgenda, deadlines }) {
  const base = { date: today, mode, done: false, createdAt: new Date().toISOString() }
  if (!ready(llm)) return { ...base, ...fallbackBrief(data, today, deadlines), source: 'fallback' }
  try {
    const out = await callJson(llm, buildBriefPrompt(data, today, mode, todayAgenda, deadlines))
    if (!out.one_thing) throw new Error('one_thing 없음')
    return { ...base, ...out, source: providerOf(llm) }
  } catch (e) {
    console.warn('[brain] 브리핑 LLM 실패 → 폴백:', e.message)
    return { ...base, ...fallbackBrief(data, today, deadlines), source: 'fallback', error: e.message }
  }
}

// ── 영어 회화 브리핑 ─────────────────────────────────────────────────────────
function fallbackEnglish(today, history) {
  const used = new Set(history.map((h) => h.expression))
  const dayIndex = Math.floor(A.parseYmd(today) / 86400000)
  for (let i = 0; i < ENGLISH_FALLBACK.length; i++) {
    const item = ENGLISH_FALLBACK[(dayIndex + i) % ENGLISH_FALLBACK.length]
    if (!used.has(item.expression) || i === ENGLISH_FALLBACK.length - 1) return item
  }
  return ENGLISH_FALLBACK[0]
}

async function makeEnglish(data, llm, { today, todayAgenda, brief }) {
  const base = { date: today, createdAt: new Date().toISOString() }
  const history = data.englishHistory || []
  if (!ready(llm)) return { ...base, ...fallbackEnglish(today, history), source: 'fallback' }
  const avoid = history.slice(-30).map((h) => h.expression)
  const prompt = `너는 한국인 학습자를 위한 영어 회화 코치다. 학습자 수준: ${data.settings.englishLevel}.
학습자의 North Star: ${data.profile.vision?.north_star || 'AI 서비스 기획자'}
오늘 일정: ${JSON.stringify(todayAgenda.map((o) => o.title))}
오늘의 단 하나: ${brief?.one_thing || ''}

오늘 바로 써먹을 수 있는 원어민 회화 표현 1개를 골라라. 가능하면 오늘 일정/커리어(면접, 커피챗, 회의, 협업, 발표, 스몰토크)와 연결하라.
교과서 표현 말고 실제 직장인이 쓰는 자연스러운 표현. 최근에 다룬 표현은 피하라: ${JSON.stringify(avoid)}

아래 JSON 만 출력하라:
{
  "expression": "핵심 표현 (영어)",
  "meaning": "한국어 뜻 (짧게)",
  "situation": "언제 쓰는지 한 줄 (한국어)",
  "dialogue": [{"speaker":"A","en":"","ko":""},{"speaker":"B","en":"","ko":""},{"speaker":"A","en":"","ko":""}],
  "variations": ["비슷한 표현 1", "비슷한 표현 2"],
  "tip": "뉘앙스/발음/실수 포인트 한 줄 (한국어)"
}`
  try {
    const out = await callJson(llm, prompt, { temperature: 0.8 })
    if (!out.expression || !Array.isArray(out.dialogue)) throw new Error('형식 오류')
    return { ...base, ...out, source: providerOf(llm) }
  } catch (e) {
    console.warn('[brain] 영어 LLM 실패 → 폴백:', e.message)
    return { ...base, ...fallbackEnglish(today, history), source: 'fallback', error: e.message }
  }
}

// ── 뉴스 3줄 요약 ────────────────────────────────────────────────────────────
async function summarizeNews(data, llm, items) {
  if (!ready(llm) || !items.length) return null
  const prompt = `다음은 오늘 수집한 기술·뉴스 헤드라인이다. ${data.settings.userName}(North Star: ${data.profile.vision?.north_star || ''})에게 의미 있는 것 위주로 정리하라.
${JSON.stringify(items.slice(0, 40).map((i) => ({ t: i.title, s: i.source })))}

아래 JSON 만 출력하라 (한국어):
{
  "bullets": ["오늘 흐름 요약 1문장", "요약 2", "요약 3"],
  "pick": {"title": "가장 읽을 가치가 있는 헤드라인 원문 그대로", "why": "왜 너에게 중요한지 한 줄"}
}`
  try {
    const out = await callJson(llm, prompt, { temperature: 0.3 })
    return { ...out, createdAt: new Date().toISOString() }
  } catch (e) {
    console.warn('[brain] 뉴스 요약 실패:', e.message)
    return null
  }
}

async function testKey(llm) {
  const out = await callJson(llm, '{"ok": true} 를 그대로 JSON 으로 출력하라.', { timeoutMs: 20000 })
  return !!out
}

module.exports = { makeBrief, makeEnglish, summarizeNews, testKey }
