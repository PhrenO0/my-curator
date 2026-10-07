// 코칭 — 일정을 보고 먼저 말을 거는 기능.
//   tips(): 규칙 기반 경고·제안 (LLM 없이 항상 동작) → 위젯 '코치' 카드
//   ask():  "?질문" → LLM 이 오늘 일정·D-day·리듬 원칙을 보고 답한다 (실패하면 tips 로 답)

const A = require('../renderer/shared/agenda.js')
const { callJson, ready } = require('./llm.js')

const DEFAULT_COACH = {
  enabled: true,
  dailyLimitMin: 480, // 하루 일정 총량 상한
  bufferMin: 15, // 일정 사이 최소 여유
  quietAfter: '23:00', // 이후는 쉬는 시간
  protect: [{ label: '교회', weekday: 0, start: '13:30', end: '16:00' }], // 지켜야 하는 시간
  principles: '지속 가능한 주간 사이클. 하루 단 하나에 집중. 여유 시간은 일정처럼 지킨다. 무리하면 줄이는 쪽을 제안.',
}

const toMin = (t) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || '')
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}
const hm = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`

// 시각이 있는 항목만 [시작, 끝] 분으로
function spans(items) {
  return items
    .map((o) => {
      const s = toMin(o.start)
      if (s == null) return null
      let e = toMin(o.end)
      if (e == null || e <= s) e = s + 60
      return { title: o.title, s, e }
    })
    .filter(Boolean)
    .sort((a, b) => a.s - b.s)
}

const dayLabel = (date, today) => (date === today ? '오늘' : date === A.addDays(today, 1) ? '내일' : A.formatKoreanDate(date))

// occ: A.occurrences 결과(오늘~7일), deadlines: A.deadlines 결과
function tips({ occ = [], deadlines = [], today, nowMin = null, coach = {} }) {
  const c = { ...DEFAULT_COACH, ...coach }
  if (c.enabled === false) return []
  const out = []
  const add = (level, date, text) => out.push({ level, date, text })
  for (let i = 0; i < 7; i++) {
    const date = A.addDays(today, i)
    const items = occ.filter((o) => o.date === date && !o.done)
    const sp = spans(items)
    const label = dayLabel(date, today)
    const total = sp.reduce((n, x) => n + (x.e - x.s), 0)
    if (total > c.dailyLimitMin) add('warn', date, `${label} 일정이 ${Math.round(total / 6) / 10}시간이에요. 하나는 다른 날로 미루는 걸 추천해요.`)
    for (const p of c.protect || []) {
      if (A.weekday(date) !== p.weekday) continue
      const ps = toMin(p.start)
      const pe = toMin(p.end)
      const hit = sp.find((x) => x.s < pe && x.e > ps)
      if (hit) add('warn', date, `${label} '${hit.title}'이(가) ${p.label} 시간(${p.start}~${p.end})과 겹쳐요.`)
    }
    const quiet = toMin(c.quietAfter)
    const late = quiet != null && sp.find((x) => x.e > quiet)
    if (late) add('info', date, `${label} '${late.title}'이(가) ${c.quietAfter} 이후 쉬는 시간을 침범해요.`)
    if (i <= 1) {
      for (let k = 1; k < sp.length; k++) {
        const gap = sp[k].s - sp[k - 1].e
        if (gap >= 0 && gap < c.bufferMin && (i > 0 || nowMin == null || sp[k].s > nowMin)) {
          add('info', date, `${label} '${sp[k - 1].title}' → '${sp[k].title}' 사이 여유가 ${gap}분뿐이에요.`)
          break
        }
      }
    }
  }
  for (const d of deadlines) {
    if (d.d >= 0 && d.d <= 3) add(d.d <= 1 ? 'warn' : 'info', d.date, `${d.d === 0 ? 'D-day' : `D-${d.d}`} ${d.title} — 오늘 30분이라도 손대 두세요.`)
  }
  // 오늘 남은 시간이 비어 있으면 쉬라고도 말해 준다
  if (!out.some((t) => t.date === today) && nowMin != null) {
    const rest = spans(occ.filter((o) => o.date === today && !o.done)).filter((x) => x.e > nowMin)
    if (!rest.length) add('good', today, '오늘 남은 일정이 없어요. 쉬는 시간도 계획의 일부예요.')
  }
  const rank = { warn: 0, info: 1, good: 2 }
  return out.sort((a, b) => rank[a.level] - rank[b.level] || a.date.localeCompare(b.date)).slice(0, 6)
}

function agendaText(occ, today) {
  const lines = []
  for (let i = 0; i < 7; i++) {
    const date = A.addDays(today, i)
    const items = occ.filter((o) => o.date === date)
    if (!items.length) continue
    lines.push(`${date}(${'일월화수목금토'[A.weekday(date)]}): ` + items.map((o) => `${o.start ? `${o.start}${o.end ? `~${o.end}` : ''} ` : ''}${o.title}${o.done ? '(완료)' : ''}`).join(', '))
  }
  return lines.join('\n') || '(일정 없음)'
}

async function ask(question, { occ = [], deadlines = [], today, now, brief, coach = {}, llm }) {
  const nowMin = now ? now.getHours() * 60 + now.getMinutes() : null
  const t = tips({ occ, deadlines, today, nowMin, coach })
  const c = { ...DEFAULT_COACH, ...coach }
  if (ready(llm)) {
    const prompt = `너는 사용자의 일정 코치다. 아래 정보로 질문에 한국어로 짧고 구체적으로 답하라. 막연한 조언 대신 바로 할 행동(시간대 포함)을 제시하고, 무리한 계획이면 줄이는 쪽을 먼저 제안하라. 모르는 건 지어내지 마라.
[지금] ${today} ${now ? hm(nowMin) : ''}
[리듬 원칙] ${c.principles}
[지켜야 하는 시간] ${(c.protect || []).map((p) => `${'일월화수목금토'[p.weekday]} ${p.start}~${p.end} ${p.label}`).join(', ') || '없음'} / ${c.quietAfter} 이후 휴식
[오늘의 단 하나] ${brief && brief.date === today ? brief.one_thing : '없음'}
[마감] ${deadlines.map((d) => `D-${d.d} ${d.title}`).join(', ') || '없음'}
[7일 일정]
${agendaText(occ, today)}
[자동 점검] ${t.map((x) => x.text).join(' / ') || '특이사항 없음'}
[질문] ${question}
JSON: {"answer": "3~6문장", "actions": ["바로 할 행동 1~3개"]}`
    try {
      const r = await callJson(llm, prompt, { temperature: 0.5 })
      if (r && r.answer) return { answer: String(r.answer), actions: (r.actions || []).map(String).slice(0, 3), source: llm.provider || 'llm', tips: t }
    } catch (e) {
      return { answer: fallbackAnswer(t), actions: [], source: 'rules', error: e.message, tips: t }
    }
  }
  return { answer: fallbackAnswer(t), actions: [], source: 'rules', tips: t }
}

function fallbackAnswer(t) {
  if (!t.length) return 'AI 엔진이 꺼져 있어 자세한 답은 못 해요. 일정상 특이사항은 없어요.'
  return 'AI 엔진이 꺼져 있어 일정 점검 결과만 알려 드려요. ' + t.map((x) => x.text).join(' ')
}

module.exports = { tips, ask, DEFAULT_COACH, spans }
