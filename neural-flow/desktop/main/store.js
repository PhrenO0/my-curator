// 로컬 JSON 저장소 — 앱의 장기 기억(REMEMBER).
// userData/neural-flow.json 하나에 일정·활동·브리핑·설정을 모두 담는다.
// 첫 실행 때 ../state.json(파이썬 에이전트와 공유하는 기억)에서 비전·활동·고정일정을 가져온다.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { ymd } = require('../renderer/shared/agenda.js')

// 설치 파일로 패키징하면 repo 밖에서 돌기 때문에 NF_STATE_JSON 으로 경로를 지정할 수 있다.
const STATE_JSON = process.env.NF_STATE_JSON || path.join(__dirname, '..', '..', 'state.json')

const DEFAULT_FEEDS = [
  { name: 'GeekNews', url: 'https://news.hada.io/rss/news' },
  { name: 'Hacker News', url: 'https://hnrss.org/frontpage' },
  { name: 'AI 뉴스', url: 'https://news.google.com/rss/search?q=%EC%83%9D%EC%84%B1%ED%98%95%20AI%20%EC%84%9C%EB%B9%84%EC%8A%A4&hl=ko&gl=KR&ceid=KR:ko' },
]

const DEFAULT_SETTINGS = {
  userName: '준상',
  geminiModel: 'gemini-2.5-flash',
  geminiKeyEnc: '',
  geminiKeyPlain: '',
  icsUrls: [],
  feeds: DEFAULT_FEEDS,
  englishLevel: '중급 (비즈니스 회화)',
  autoStart: true,
  widget: {
    visible: true,
    x: null,
    y: null,
    width: 360,
    opacity: 0.72,
    theme: 'dark',
    clickThrough: false,
    showOneThing: true,
    showCalendar: true,
    showNews: true,
    showEnglish: true,
  },
  schedule: {
    briefTime: '07:00',
    checkinTime: '22:00',
    weeklyDay: 0, // 0 = 일요일
    weeklyTime: '20:00',
    newsEveryHours: 3,
  },
}

function uid() {
  return crypto.randomBytes(6).toString('hex')
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    return null
  }
}

function toDateOnly(raw) {
  if (!raw) return null
  const m = String(raw).match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/)
  return m ? { date: m[1], time: m[2] || null } : null
}

// state.json → 앱 데이터로 변환 (비전·영역은 profile, 활동/고정일정/앵커는 events·activities)
function fromStateJson(state) {
  const profile = {
    vision: state.vision || {},
    goals: state.goals || {},
    domains: (state.domains || []).map((d) => ({ name: d.name, sub: d.sub || [] })),
  }
  const events = []
  for (const b of state.fixed_blocks || []) {
    const d = toDateOnly(b.date)
    if (!d) continue
    events.push({
      id: uid(),
      title: b.title,
      date: d.date,
      start: d.time,
      end: null,
      domain: '',
      note: '',
      repeat: null,
      deadline: true, // agent.py 의 compute_deadlines 와 동일하게 고정일정은 D-day 대상
      source: 'local',
    })
  }
  for (const a of state.daily_anchors || []) {
    const t = String(a.time || '').match(/\d{2}:\d{2}/)
    events.push({
      id: uid(),
      title: a.title,
      date: ymd(new Date()),
      start: t ? t[0] : null,
      end: null,
      domain: a.domain || '',
      note: '데일리 앵커 (state.json)',
      repeat: 'daily',
      deadline: false,
      source: 'local',
    })
  }
  const activities = (state.activities || []).map((a) => ({
    id: uid(),
    name: a.name,
    domain: a.domain || '',
    priority: a.priority || '중간',
    energy: a.energy || '가벼움',
    repeat: a.repeat || '1회',
    min: a.min || null,
    date: a.date || null,
    status: a.status || '제안됨',
    why: a.why || '',
  }))
  return { profile, events, activities }
}

function emptyData() {
  return {
    version: 1,
    settings: structuredClone(DEFAULT_SETTINGS),
    profile: { vision: {}, goals: {}, domains: [] },
    events: [],
    activities: [],
    brief: null,
    english: null,
    englishHistory: [],
    news: { fetchedAt: null, items: [], summary: null },
    remote: { fetchedAt: null, events: [], errors: [] },
    history: [],
    doneMap: {},
    lastRun: {},
  }
}

// 설정은 기본값 위에 깊게 덮어써서, 버전이 올라가 새 설정이 생겨도 깨지지 않게.
function mergeSettings(saved) {
  const base = structuredClone(DEFAULT_SETTINGS)
  if (!saved) return base
  return {
    ...base,
    ...saved,
    widget: { ...base.widget, ...(saved.widget || {}) },
    schedule: { ...base.schedule, ...(saved.schedule || {}) },
  }
}

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'neural-flow.json')
    this.data = null
    this.listeners = new Set()
    this._timer = null
  }

  load() {
    const saved = readJson(this.file)
    if (saved) {
      this.data = { ...emptyData(), ...saved, settings: mergeSettings(saved.settings) }
    } else {
      this.data = emptyData()
      const state = readJson(STATE_JSON)
      if (state) {
        const seeded = fromStateJson(state)
        Object.assign(this.data, seeded)
        console.log(`[store] state.json에서 활동 ${seeded.activities.length}개 · 일정 ${seeded.events.length}개를 가져옴`)
      }
      this.flush()
    }
    // 비전·영역은 state.json 이 원본 — 있으면 매 실행마다 최신으로 맞춘다.
    const state = readJson(STATE_JSON)
    if (state && state.vision) this.data.profile = fromStateJson(state).profile
    return this
  }

  get() {
    return this.data
  }

  // 변경 → 디바운스 저장 → 구독자 알림
  update(fn) {
    fn(this.data)
    this._scheduleFlush()
    for (const l of this.listeners) l()
  }

  onChange(fn) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  _scheduleFlush() {
    clearTimeout(this._timer)
    this._timer = setTimeout(() => this.flush(), 300)
  }

  flush() {
    clearTimeout(this._timer)
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = this.file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8')
    fs.renameSync(tmp, this.file)
  }
}

module.exports = { Store, uid, DEFAULT_SETTINGS }
