// 구글 캘린더 읽기 — '비공개 iCal 주소'(ICS)를 받아 반복 일정까지 펼친다.
// OAuth 없이 붙일 수 있는 가장 간단한 방법. 쓰기(일정 추가)는 앱 내부 일정으로만 한다.

const ical = require('node-ical')
const A = require('../renderer/shared/agenda.js')

async function fetchIcs(url) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 20000)
  try {
    // webcal:// 도 받아준다
    const res = await fetch(url.replace(/^webcal:/i, 'https:'), { signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(t)
  }
}

function toItems(parsed, from, to, calendarName) {
  const out = []
  for (const ev of Object.values(parsed)) {
    if (!ev || ev.type !== 'VEVENT') continue
    let instances = []
    try {
      instances = ical.expandRecurringEvent(ev, { from, to, expandOngoing: true })
    } catch (e) {
      continue
    }
    for (const ins of instances) {
      const start = ins.start
      if (!start) continue
      const allDay = !!ins.isFullDay
      const date = A.ymd(start)
      out.push({
        uid: String(ev.uid || ins.summary),
        title: String(ins.summary || ev.summary || '(제목 없음)'),
        date,
        start: allDay ? null : A.hm(start),
        end: allDay || !ins.end ? null : A.hm(ins.end),
        location: ev.location ? String(ev.location) : '',
        calendar: calendarName,
      })
    }
  }
  return out
}

// 오늘 기준 -45일 ~ +150일
async function pullRemote(urls) {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 45)
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 150)
  const events = []
  const errors = []
  for (const url of urls.filter(Boolean)) {
    try {
      const text = await fetchIcs(url)
      const parsed = ical.sync.parseICS(text)
      const cal = Object.values(parsed).find((c) => c && c.type === 'VCALENDAR')
      const name = (cal && cal['WR-CALNAME']) || '구글 캘린더'
      events.push(...toItems(parsed, from, to, String(name)))
    } catch (e) {
      errors.push({ url: url.replace(/private-[^/]+/, 'private-***'), message: e.message })
    }
  }
  return { events, errors, fetchedAt: new Date().toISOString() }
}

module.exports = { pullRemote, toItems }
