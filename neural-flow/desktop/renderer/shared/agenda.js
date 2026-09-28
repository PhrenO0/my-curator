// 일정 계산 코어 — 메인 프로세스(require)와 화면(<script>) 양쪽에서 같은 로직을 쓴다.
// 날짜는 전부 로컬 기준 'YYYY-MM-DD' 문자열로 다룬다 (시간대 버그 방지).
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.NFAgenda = factory()
})(typeof self !== 'undefined' ? self : this, function () {
  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

  const DOMAIN_COLORS = {
    '영성·내면': '#a78bfa',
    '정신·심리': '#60a5fa',
    '신체·건강': '#34d399',
    '지성·성장': '#fbbf24',
    '관계·사랑': '#f472b6',
    '일·소명': '#e0a878',
    '재정·경제': '#fb923c',
    '창조·표현': '#f87171',
    '환경·일상': '#94a3b8',
  }
  const REMOTE_COLOR = '#7dd3fc'
  const DEFAULT_COLOR = '#a1a1aa'

  const pad = (n) => String(n).padStart(2, '0')

  function ymd(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }
  function hm(d) {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  function parseYmd(s) {
    const [y, m, d] = s.split('-').map(Number)
    return new Date(y, m - 1, d)
  }
  function addDays(s, n) {
    const d = parseYmd(s)
    d.setDate(d.getDate() + n)
    return ymd(d)
  }
  function diffDays(a, b) {
    return Math.round((parseYmd(b) - parseYmd(a)) / 86400000)
  }
  function weekday(s) {
    return parseYmd(s).getDay()
  }

  // '✝️ 영성·내면' 처럼 이모지가 붙어 있어도 색을 찾는다.
  function domainColor(domain) {
    if (!domain) return DEFAULT_COLOR
    for (const key of Object.keys(DOMAIN_COLORS)) if (domain.includes(key)) return DOMAIN_COLORS[key]
    return DEFAULT_COLOR
  }
  function domainEmoji(domain) {
    const m = String(domain || '').match(/^\S+/)
    return m && !/[가-힣A-Za-z]/.test(m[0]) ? m[0] : ''
  }

  function occursOn(ev, day) {
    if (ev.until && day > ev.until) return false
    if (day < ev.date) return false
    switch (ev.repeat) {
      case 'daily':
        return true
      case 'weekdays': {
        const w = weekday(day)
        return w >= 1 && w <= 5
      }
      case 'weekly':
        return weekday(day) === weekday(ev.date)
      case 'monthly':
        return day.slice(8) === ev.date.slice(8)
      default:
        return day === ev.date
    }
  }

  // 기간 내 모든 항목을 날짜별로 펼친다: 로컬 일정 + 구글 캘린더(ICS) + 날짜가 있는 활동
  function occurrences({ events = [], remote = [], activities = [], doneMap = {} }, from, to) {
    const out = []
    for (let day = from; day <= to; day = addDays(day, 1)) {
      for (const ev of events) {
        if (!occursOn(ev, day)) continue
        const key = `${ev.id}@${day}`
        out.push({
          key,
          id: ev.id,
          kind: 'event',
          title: ev.title,
          date: day,
          start: ev.start || null,
          end: ev.end || null,
          domain: ev.domain || '',
          color: domainColor(ev.domain),
          repeat: ev.repeat || null,
          deadline: !!ev.deadline,
          done: !!doneMap[key],
          note: ev.note || '',
        })
      }
    }
    for (const r of remote) {
      if (r.date < from || r.date > to) continue
      out.push({
        key: `r:${r.uid}@${r.date}${r.start || ''}`,
        id: r.uid,
        kind: 'remote',
        title: r.title,
        date: r.date,
        start: r.start,
        end: r.end,
        domain: r.calendar || '',
        color: REMOTE_COLOR,
        location: r.location || '',
        done: false,
      })
    }
    for (const a of activities) {
      if (!a.date || a.date < from || a.date > to || a.status === '보류') continue
      out.push({
        key: `a:${a.id}`,
        id: a.id,
        kind: 'activity',
        title: a.name,
        date: a.date,
        start: a.start || null,
        end: null,
        domain: a.domain,
        color: domainColor(a.domain),
        done: a.status === '완료',
        status: a.status,
        priority: a.priority,
        min: a.min,
      })
    }
    // 종일 → 시간순
    out.sort((x, y) => (x.date + (x.start || '00:00')).localeCompare(y.date + (y.start || '00:00')))
    return out
  }

  function byDay(list) {
    const map = {}
    for (const o of list) (map[o.date] = map[o.date] || []).push(o)
    return map
  }

  // agent.py compute_deadlines 와 같은 규칙: D-1 ~ D+14 사이의 마감/고정일정
  function deadlines({ events = [], activities = [] }, today, horizon = 14) {
    const out = []
    for (const ev of events) {
      if (!ev.deadline || ev.repeat) continue
      const d = diffDays(today, ev.date)
      if (d >= -1 && d <= horizon) out.push({ id: ev.id, title: ev.title, date: ev.date, d, color: domainColor(ev.domain) })
    }
    for (const a of activities) {
      if (a.priority !== '높음' || !a.date || a.status === '완료' || a.status === '보류') continue
      const d = diffDays(today, a.date)
      if (d >= 0 && d <= 3) out.push({ id: a.id, title: a.name, date: a.date, d, color: domainColor(a.domain), activity: true })
    }
    return out.sort((x, y) => x.d - y.d)
  }

  function dLabel(d) {
    if (d === 0) return 'D-DAY'
    return d > 0 ? `D-${d}` : `D+${-d}`
  }

  // 월 달력 그리드(일요일 시작, 6주 고정)
  function monthGrid(year, month) {
    const first = new Date(year, month, 1)
    const start = new Date(year, month, 1 - first.getDay())
    const cells = []
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
      cells.push({ date: ymd(d), day: d.getDate(), inMonth: d.getMonth() === month, weekday: d.getDay() })
    }
    return cells
  }

  function formatKoreanDate(s) {
    const d = parseYmd(s)
    return `${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEKDAYS[d.getDay()]}요일`
  }

  return {
    WEEKDAYS,
    DOMAIN_COLORS,
    REMOTE_COLOR,
    ymd,
    hm,
    parseYmd,
    addDays,
    diffDays,
    weekday,
    domainColor,
    domainEmoji,
    occursOn,
    occurrences,
    byDay,
    deadlines,
    dLabel,
    monthGrid,
    formatKoreanDate,
  }
})
