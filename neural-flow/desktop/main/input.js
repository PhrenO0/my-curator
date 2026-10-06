// 언제든 입력 — "내일 오후 3시 커피챗 강남" 같은 한 줄을 일정/할 일/오늘의 단 하나/메모로 바꾼다.
// 1) LLM(Gemini·Claude Code)이 있으면 LLM 이 해석
// 2) 없거나 실패하면 한국어 규칙 파서 (날짜·시간·기간)
// 결과는 바로 실행하지 않고 '미리보기'로 돌려준다 → 사용자가 확인하면 실행 (승인 게이트).

const A = require('../renderer/shared/agenda.js')
const { callJson, providerOf, ready } = require('./llm.js')

const WD = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 }
const KINDS = ['event', 'task', 'one_thing', 'note']

function nextWeekday(today, wd, nextWeek) {
  const cur = A.weekday(today)
  if (nextWeek) {
    // '다음주 X요일' = 다음 주 월요일 기준
    const monday = A.addDays(today, ((8 - cur) % 7) || 7)
    return A.addDays(monday, (wd + 6) % 7)
  }
  return A.addDays(today, (wd - cur + 7) % 7)
}

function parseRules(text, today) {
  let s = ` ${text.trim()} `
  const take = (re) => {
    const m = s.match(re)
    if (m) s = s.replace(m[0], ' ')
    return m
  }
  let kind = null
  if (/^\s*!/.test(s) || /오늘의\s*단\s*하나/.test(s)) {
    kind = 'one_thing'
    s = s.replace(/^\s*!/, ' ').replace(/오늘의\s*단\s*하나\s*[:：]?/, ' ')
  } else if (/^\s*(메모|노트)\s*[:：]/.test(s)) {
    kind = 'note'
    s = s.replace(/^\s*(메모|노트)\s*[:：]/, ' ')
  }

  // ── 날짜 ──
  let date = null
  let m
  if ((m = take(/(\d{4})-(\d{1,2})-(\d{1,2})/))) date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  else if ((m = take(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/)) || (m = take(/(?<![\d:])(\d{1,2})\/(\d{1,2})(?![\d/])/))) {
    const y = Number(today.slice(0, 4))
    let d = `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
    if (d < A.addDays(today, -30)) d = `${y + 1}${d.slice(4)}` // 이미 지난 날짜면 내년
    date = d
  } else if ((m = take(/(오늘|내일|모레|글피)/))) date = A.addDays(today, { 오늘: 0, 내일: 1, 모레: 2, 글피: 3 }[m[1]])
  else if ((m = take(/(이번\s*주|다음\s*주|담주)?\s*([일월화수목금토])요일/))) date = nextWeekday(today, WD[m[2]], m[1] && !/이번/.test(m[1]))
  else if ((m = take(/(\d{1,2})\s*일(?!\s*(?:간|동안))/))) {
    let d = `${today.slice(0, 8)}${m[1].padStart(2, '0')}`
    if (d < today) {
      const t = A.parseYmd(today)
      d = A.ymd(new Date(t.getFullYear(), t.getMonth() + 1, Number(m[1])))
    }
    date = d
  }

  // ── 기간 (먼저 떼어내야 'N시간'이 시각으로 안 읽힌다) ──
  let minutes = null
  if ((m = take(/(\d+(?:\.\d+)?)\s*시간(?:\s*(\d+)\s*분)?\s*(?:동안)?/))) minutes = Math.round(Number(m[1]) * 60 + Number(m[2] || 0))
  else if ((m = take(/(\d+)\s*분\s*(?:동안|간)/))) minutes = Number(m[1])

  // ── 시각 ──
  let start = null
  if ((m = take(/(오전|오후|아침|낮|저녁|밤|새벽)?\s*(\d{1,2})\s*시\s*(?:(\d{1,2})\s*분|(반))?/))) {
    let h = Number(m[2])
    const pm = /오후|저녁|밤/.test(m[1] || '') || (m[1] === '낮' && h < 6)
    if (pm && h < 12) h += 12
    if (/오전|새벽|아침/.test(m[1] || '') && h === 12) h = 0
    if (!m[1] && h >= 1 && h <= 6) h += 12 // '3시 미팅' 은 보통 오후
    start = `${String(h % 24).padStart(2, '0')}:${m[4] ? '30' : String(m[3] || 0).padStart(2, '0')}`
  } else if ((m = take(/(?<!\d)(\d{1,2}):(\d{2})(?!\d)/))) start = `${m[1].padStart(2, '0')}:${m[2]}`

  const title = s
    .replace(/\s+(에|에서|까지|부터)(?=\s)/g, ' ')
    .replace(/^\s*(에|에서)\s+/, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  if (!kind) kind = date || start ? 'event' : 'task'
  if (kind === 'event' && !date) date = today
  return { kind, title: title || text.trim(), date, start, minutes, source: 'rules' }
}

async function interpret(text, { today, llm, profile }) {
  const rules = parseRules(text, today)
  if (!ready(llm)) return rules
  const prompt = `너는 일정 비서다. 사용자가 데스크탑에서 빠르게 입력한 한 줄을 구조화하라.
오늘: ${today} (${A.WEEKDAYS[A.weekday(today)]}요일), 시간대: 한국
9개 영역: ${JSON.stringify((profile?.domains || []).map((d) => d.name))}
입력: ${JSON.stringify(text)}

kind 규칙: 날짜나 시각이 있는 약속·일정 = "event", 해야 할 일(날짜 없음) = "task",
'!' 로 시작하거나 '오늘의 단 하나' = "one_thing", '메모:' = "note".
아래 JSON 만 출력하라:
{"kind":"event|task|one_thing|note","title":"간결한 제목(날짜·시간 표현 제외)","date":"YYYY-MM-DD 또는 null","start":"HH:mm 또는 null","minutes":60,"domain":"9개 영역 중 하나 또는 빈 문자열","reply":"한 줄 확인 문구"}`
  try {
    const out = await callJson(llm, prompt, { temperature: 0.1, timeoutMs: providerOf(llm) === 'claude' ? 60000 : 20000 })
    if (!KINDS.includes(out.kind) || !out.title) throw new Error('형식 오류')
    const okDate = /^\d{4}-\d{2}-\d{2}$/.test(out.date || '') ? out.date : null
    const okStart = /^\d{2}:\d{2}$/.test(out.start || '') ? out.start : null
    return {
      kind: out.kind,
      title: String(out.title).trim(),
      date: out.kind === 'event' ? okDate || rules.date || today : okDate,
      start: okStart,
      minutes: Number(out.minutes) || rules.minutes || null,
      domain: out.domain || '',
      reply: out.reply || '',
      source: providerOf(llm),
    }
  } catch (e) {
    return { ...rules, error: e.message }
  }
}

module.exports = { parseRules, interpret }
