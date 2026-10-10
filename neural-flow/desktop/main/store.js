// 로컬 JSON 저장소 — 앱의 장기 기억(REMEMBER).
// userData/neural-flow.json 하나에 일정·활동·브리핑·설정을 모두 담는다.
// 첫 실행 때 ../state.json(파이썬 에이전트와 공유하는 기억)에서 비전·활동·고정일정을 가져온다.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

// 설치 파일로 패키징하면 repo 밖에서 돌기 때문에 NF_STATE_JSON 으로 경로를 지정할 수 있다.
// 설치 파일 안에서는 resources/state.json (빌드 때 같이 넣음)을 쓴다.
const STATE_JSON =
  process.env.NF_STATE_JSON ||
  [path.join(__dirname, '..', '..', 'state.json'), process.resourcesPath && path.join(process.resourcesPath, 'state.json')]
    .filter(Boolean)
    .find((p) => fs.existsSync(p)) ||
  path.join(__dirname, '..', '..', 'state.json')
const CONFIG_JSON = path.join(path.dirname(STATE_JSON), 'config.json')

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
  // LLM 엔진: auto(Claude Code 있으면 그것, 없으면 Gemini 키, 둘 다 없으면 규칙) | claude | gemini | off
  engine: 'auto',
  codexCmd: 'codex',
  codexModel: '',
  claudeCmd: 'claude',
  claudeModel: '',
  // 로그인: 허용된 구글 계정만 앱을 열 수 있다
  requireLogin: true,
  google: {
    clientId: '',
    clientSecretEnc: '',
    clientSecretPlain: '',
    allowedEmails: [], // 비어 있으면 config.json 의 userEmail, 그것도 없으면 첫 로그인 계정이 주인이 된다
    calendarIds: null, // null = 구글에서 '표시'로 켜 둔 캘린더 전부
    defaultCalendar: 'primary',
  },
  quickShortcut: 'CommandOrControl+Shift+Space',
  security: {
    encryptData: true, // 저장 파일을 OS 키체인으로 암호화
    pinHash: '', // 'scrypt:salt:hash' — 있으면 자리 비움·화면 잠금 뒤 PIN 으로 다시 연다
    idleLockMinutes: 15, // 0 = 끔
    lockOnScreenLock: true,
    contentProtection: true, // 화면 공유·캡처에 앱 창이 찍히지 않게
    privacyMode: false, // 위젯 내용 가리기
  },
  updates: { autoCheck: true, autoInstall: true, skipVersion: '' },
  coach: { enabled: false },
  study: { folder: '' }, // 과목 자료 폴더 (예: exam-study 레포 — 그 안의 '과목/<과목명>/')
  widget: {
    visible: true,
    x: null,
    y: null,
    width: 360,
    opacity: 0.72,
    theme: 'auto',
    clickThrough: false,
    showOneThing: false,
    showCoach: false,
    showCalendar: true,
    showNews: false,
    showEnglish: false,
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
    account: null, // { email, name, picture, refreshEnc }
    notes: [],
    inbox: [],
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
    google: { ...base.google, ...(saved.google || {}) },
    security: { ...base.security, ...(saved.security || {}) },
    updates: { ...base.updates, ...(saved.updates || {}) },
    coach: { ...base.coach, ...(saved.coach || {}) },
    study: { ...base.study, ...(saved.study || {}) },
  }
}

// 디스크 암호화: cipher = { encrypt(str) → Buffer, decrypt(Buffer) → str } (main 에서 OS 키체인 safeStorage 로 넘긴다)
const MAGIC = 'NFENC1\n'

class Store {
  constructor(dir, { cipher = null } = {}) {
    this.cipher = cipher
    this.file = path.join(dir, 'neural-flow.json')
    this.data = null
    this.listeners = new Set()
    this._timer = null
  }

  _read() {
    let raw
    try {
      raw = fs.readFileSync(this.file, 'utf-8')
    } catch {
      return null
    }
    if (raw.startsWith(MAGIC)) {
      if (!this.cipher) throw new Error('암호화된 데이터인데 복호화 수단이 없어요')
      return JSON.parse(this.cipher.decrypt(Buffer.from(raw.slice(MAGIC.length), 'base64')))
    }
    try {
      return JSON.parse(raw) // 옛 평문 파일 → 다음 저장 때 암호화된다
    } catch {
      return null
    }
  }

  get encrypted() {
    try {
      return fs.readFileSync(this.file, 'utf-8').startsWith(MAGIC)
    } catch {
      return false
    }
  }

  load() {
    const saved = this._read()
    if (saved) {
      this.data = { ...emptyData(), ...saved, settings: mergeSettings(saved.settings) }
    } else {
      this.data = emptyData()
      this.flush()
    }
    // 허용 계정 기본값: config.json 의 userEmail (레포 주인)
    const g = this.data.settings.google
    if (!g.allowedEmails?.length) {
      const cfg = readJson(CONFIG_JSON)
      if (cfg?.userEmail) g.allowedEmails = [String(cfg.userEmail).toLowerCase()]
    }
    // Calendar-only migration: remove identifiable generated anchors and suggestions.
    // Preserve manual events and ambiguous legacy data; never delete Google events.
    if (this.data.calendarOnlyVersion !== 1) {
      this.data.events = this.data.events.filter((e) => e.note !== '데일리 앵커 (state.json)' && e.source !== 'generated')
      this.data.activities = this.data.activities.filter((a) => a.status !== '제안됨' && a.source !== 'generated')
      this.data.brief = null
      this.data.english = null
      this.data.englishHistory = []
      this.data.news = { fetchedAt: null, items: [], summary: null }
      this.data.settings.engine = 'off'
      for (const key of ['showOneThing', 'showCoach', 'showNews', 'showEnglish']) this.data.settings.widget[key] = false
      this.data.calendarOnlyVersion = 1
      this.flush()
    }
    // Re-enable the input-only engine after the calendar-only transition.
    if (!this.data.inputEngineVersion) {
      this.data.settings.engine = 'auto'
      this.data.inputEngineVersion = 1
      this.flush()
    }
    if (!this.data.autoUpdateVersion) {
      this.data.settings.updates.autoCheck = true
      this.data.settings.updates.autoInstall = true
      this.data.autoUpdateVersion = 1
      this.flush()
    }
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
    const json = JSON.stringify(this.data, null, 2)
    const body = this.cipher && this.data.settings?.security?.encryptData !== false ? MAGIC + this.cipher.encrypt(json).toString('base64') : json
    fs.writeFileSync(tmp, body, { encoding: 'utf-8', mode: 0o600 }) // 내 계정만 읽기·쓰기
    fs.renameSync(tmp, this.file)
  }
}

module.exports = { Store, uid, DEFAULT_SETTINGS, MAGIC }
