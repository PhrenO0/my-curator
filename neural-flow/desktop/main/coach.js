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
  rhythmFile: '', // 리듬 문서 경로 (.md)
  principles: '지속 가능한 주간 사이클. 하루 단 하나에 집중. 여유 시간은 일정처럼 지킨다. 무리하면 줄이는 쪽을 제안.',
}

// 리듬 문서(예: exam-study/리듬.md)를 코치의 기준으로 읽는다
const fs = require('fs')
function rhythmDoc(c) {
  if (!c.rhythmFile) return ''
  try {
    return fs.readFileSync(c.rhythmFile, 'utf8').slice(0, 6000)
  } catch {
    return ''
  }
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
      return { title: o.title, s, e, free: !!o.free }
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
      const hit = sp.find((x) => !x.free && x.s < pe && x.e > ps)
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
    lines.push(`${date}(${'일월화수목금토'[A.weekday(date)]}): ` + items.map((o) => `${o.start ? `${o.start}${o.end ? `~${o.end}` : ''} ` : '종일 '}${o.title}${o.free ? '(유동 블록)' : ''}${o.done ? '(완료)' : ''}${o.location ? ` @${o.location.slice(0, 30)}` : ''}${o.note ? ` — ${o.note.slice(0, 120)}` : ''}`).join('\n  '))
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
${rhythmDoc(c) ? `[리듬 문서]\n${rhythmDoc(c)}\n` : ''}[지켜야 하는 시간] ${(c.protect || []).map((p) => `${'일월화수목금토'[p.weekday]} ${p.start}~${p.end} ${p.label}`).join(', ') || '없음'} / ${c.quietAfter} 이후 휴식
[오늘의 단 하나] ${brief && brief.date === today ? brief.one_thing : '없음'}
[마감] ${deadlines.map((d) => `D-${d.d} ${d.title}`).join(', ') || '없음'}
[7일 일정]
${agendaText(occ, today)}
[자동 점검] ${t.map((x) => x.text).join(' / ') || '특이사항 없음'}
[질문] ${question}
JSON: {"answer": "3~6문장", "actions": ["바로 할 행동 1~3개"], "facts": ["직접 확인한 사실 (출처 URL 포함)"]}`
    try {
      const r = await callJson(llm, prompt, { temperature: 0.5, web: true })
      if (r && r.answer) return { answer: String(r.answer), actions: (r.actions || []).map(String).slice(0, 3), facts: (r.facts || []).map(String).slice(0, 5), source: llm.provider || 'llm', tips: t }
    } catch (e) {
      return { answer: fallbackAnswer(t), actions: [], source: 'rules', error: e.message, tips: t }
    }
  }
  return { answer: fallbackAnswer(t), actions: [], source: 'rules', tips: t }
}

// 새 일정 하나를 평가: 겹침 · 체력 · 전략 → 추천/선택/비추천
// occ: 그 날짜 앞뒤 하루 일정, deadlines: A.deadlines 결과
function checkFit(item, { occ = [], deadlines = [], coach = {} }) {
  const c = { ...DEFAULT_COACH, ...coach }
  const s = toMin(item.start)
  const len = Number(item.minutes) || 90
  const span = s == null ? null : { s, e: s + len }
  const day = spans(occ.filter((o) => o.date === item.date && !o.done))
  const overlap = span ? day.filter((x) => x.s < span.e && x.e > span.s) : []
  const conflicts = overlap.filter((x) => !x.free).map((x) => `${hm(x.s)} ${x.title}`)
  const soft = overlap.filter((x) => x.free).map((x) => `${hm(x.s)} ${x.title}`)
  const protects = (c.protect || []).filter((p) => span && A.weekday(item.date) === p.weekday && toMin(p.start) < span.e && toMin(p.end) > span.s).map((p) => p.label)
  const dayMin = day.reduce((n, x) => n + (x.e - x.s), 0) + (span ? len : 0)
  const late = span && toMin(c.quietAfter) != null && span.e > toMin(c.quietAfter)
  const prevDay = spans(occ.filter((o) => o.date === A.addDays(item.date, -1)))
  const nextDay = spans(occ.filter((o) => o.date === A.addDays(item.date, 1)))
  const nextEarly = nextDay.find((x) => x.s < 9 * 60)
  const near = deadlines.filter((d) => Math.abs(A.diffDays(item.date, d.date)) <= 2)
  let energy = dayMin > c.dailyLimitMin ? '빡빡' : dayMin > c.dailyLimitMin * 0.6 ? '보통' : '여유'
  if (late && energy === '여유') energy = '보통'
  const notes = []
  if (conflicts.length) notes.push(`겹침: ${conflicts.join(', ')}`)
  if (soft.length) notes.push(`옮길 수 있는 블록과 겹침: ${soft.join(', ')}`)
  if (protects.length) notes.push(`${protects.join(', ')} 시간과 겹침`)
  if (late) notes.push(`${c.quietAfter} 이후 쉬는 시간 침범`)
  if (nextEarly) notes.push(`다음 날 ${hm(nextEarly.s)} ${nextEarly.title}`)
  if (near.length) notes.push(`가까운 마감: ${near.map((d) => d.title).join(', ')}`)
  notes.push(`그날 일정 총 ${Math.round(dayMin / 6) / 10}시간 (전날 ${Math.round(prevDay.reduce((n, x) => n + x.e - x.s, 0) / 6) / 10}시간)`)
  return { conflicts, soft, protects, late: !!late, energy, dayMin, notes }
}

async function evaluate(item, { occ = [], deadlines = [], coach = {}, profile = {}, llm }) {
  const fit = checkFit(item, { occ, deadlines, coach })
  const c = { ...DEFAULT_COACH, ...coach }
  const hard = fit.conflicts.length || fit.protects.length
  const base = {
    ...fit,
    verdict: hard ? '비추천' : fit.energy === '빡빡' ? '선택' : '추천',
    strategy: '',
    advice: hard ? '겹치는 일정이 있어요. 어느 쪽이 더 중요한지 정하고 하나는 옮기세요.' : fit.energy === '빡빡' ? '그날이 빡빡해요. 참석한다면 다른 일 하나를 미루세요.' : '일정상 무리는 없어요.',
    source: 'rules',
  }
  if (!ready(llm)) return { ...base, strategy: 'AI 엔진이 꺼져 있어 전략 평가는 못 했어요.' }
  const prompt = `너는 사용자의 일정 코치다. 새 일정 후보를 평가하라. 아첨하지 말고 솔직하게, 근거는 아래 정보에서만.
[후보] ${item.title} / ${item.date} ${item.start || '시각 미정'} ${item.minutes ? `${item.minutes}분` : ''}
[요약] ${item.summary || ''}
[비전·목표] ${JSON.stringify({ vision: profile.vision || {}, goals: profile.goals || {} }).slice(0, 1500)}
[영역] ${(profile.domains || []).map((d) => d.name).join(', ')}
[리듬 원칙] ${c.principles}
${rhythmDoc(c) ? `[리듬 문서]\n${rhythmDoc(c)}\n` : ''}[자동 점검] ${fit.notes.join(' / ')} / 체력 ${fit.energy}
[주변 일정]
${agendaText(occ, A.addDays(item.date, -1))}
JSON: {"verdict":"추천|선택|비추천","energy":"여유|보통|빡빡","strategy":"인생·커리어 전략상 의미 2문장 (목표와 연결되는지)","advice":"참석 여부와 준비/조정 방법 2문장","facts":["직접 확인한 사실 (출처 URL 포함), 주변 일정 중 마감이 불분명한 것의 실제 마감 포함"]}`
  try {
    const r = await callJson(llm, prompt, { temperature: 0.4, web: true })
    return {
      ...base,
      verdict: ['추천', '선택', '비추천'].includes(r.verdict) ? r.verdict : base.verdict,
      energy: ['여유', '보통', '빡빡'].includes(r.energy) ? r.energy : base.energy,
      strategy: String(r.strategy || ''),
      advice: String(r.advice || base.advice),
      facts: (r.facts || []).map(String).slice(0, 5),
      source: llm.provider || 'llm',
    }
  } catch (e) {
    return { ...base, strategy: `AI 평가 실패: ${e.message.slice(0, 80)}`, error: e.message }
  }
}

function fallbackAnswer(t) {
  if (!t.length) return 'AI 엔진이 꺼져 있어 자세한 답은 못 해요. 일정상 특이사항은 없어요.'
  return 'AI 엔진이 꺼져 있어 일정 점검 결과만 알려 드려요. ' + t.map((x) => x.text).join(' ')
}

module.exports = { tips, ask, checkFit, evaluate, rhythmDoc, DEFAULT_COACH, spans }
