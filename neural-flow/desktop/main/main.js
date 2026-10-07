// neural-flow desktop — 메인 프로세스
// SENSE(일정·캘린더·뉴스) → THINK(Gemini) → ACT(위젯·알림) → REMEMBER(로컬 저장) 루프를
// 사용자의 PC 안에서 상시 돌린다.

const path = require('path')
const fs = require('fs')
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  nativeImage,
  nativeTheme,
  Notification,
  screen,
  shell,
  safeStorage,
  globalShortcut,
  powerMonitor,
  session,
  dialog,
} = require('electron')
const updater = require('./updater.js')
const security = require('./security.js')

const { Store, uid } = require('./store.js')
const A = require('../renderer/shared/agenda.js')
const brain = require('./brain.js')
const { pullRemote } = require('./calendar.js')
const { pullNews } = require('./news.js')
const { createScheduler } = require('./scheduler.js')
const google = require('./google.js')
const { interpret } = require('./input.js')
const coach = require('./coach.js')
const { detectClaude, providerOf } = require('./llm.js')
const { pinToDesktop } = require('./win-desktop.js')

const ROOT = path.join(__dirname, '..')
const PRELOAD = path.join(ROOT, 'preload.js')
const IS_WIN = process.platform === 'win32'
const IS_MAC = process.platform === 'darwin'
const DEV = process.argv.includes('--dev')
const TEST_HOOK = process.env.NF_TEST_HOOK // 테스트용: E2E 스크립트 경로 (스케줄러를 끄고 스크립트가 앱을 조작)

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}
if (IS_WIN) app.setAppUserModelId('com.junsang.neuralflow')

let store
let widget = null
let manager = null
let tray = null
let quick = null
let widgetMode = 'pinned' // pinned(바탕화면 고정) | edit(이동·상호작용)
let desktopPin = null // Windows Win+D 보호
let claudeVersion = null // 노트북에 설치된 Claude Code 버전 (없으면 null)
const busy = {}

// ── 비밀값 암호화 (OS 키체인) ────────────────────────────────────────────────
const enc = (v) => (v && safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(v).toString('base64') : v ? 'raw:' + v : '')
function dec(v) {
  if (!v) return ''
  if (v.startsWith('raw:')) return v.slice(4)
  try {
    return safeStorage.decryptString(Buffer.from(v.replace(/^enc:/, ''), 'base64'))
  } catch {
    return ''
  }
}

// 설치 파일에 같이 구운 구글 OAuth 클라이언트 (release 워크플로가 GitHub 비밀값으로 만든다).
// 있으면 기기마다 클라이언트 ID 를 붙여넣지 않고 'Google 로그인' 버튼만 누르면 된다.
function applyBuildConfig() {
  if (TEST_HOOK && !process.env.NF_BUILD_CONFIG) return
  let cfg = null
  try {
    cfg = JSON.parse(fs.readFileSync(process.env.NF_BUILD_CONFIG || path.join(ROOT, 'build-config.json'), 'utf-8'))
  } catch {
    return
  }
  const g = store.get().settings.google
  if (!g.clientId && cfg.googleClientId)
    store.update((d) => {
      d.settings.google.clientId = cfg.googleClientId
      if (cfg.googleClientSecret) d.settings.google.clientSecretEnc = enc(cfg.googleClientSecret)
    })
}

// ── 로그인 (허용된 구글 계정만) ──────────────────────────────────────────────
// 세션 잠금: PIN 이 있을 때 자리 비움·화면 잠금 뒤 다시 잠근다 (PIN 으로 해제)
let sessionLocked = false
const needsLogin = () => store.get().settings.requireLogin !== false && !store.get().account?.email
const locked = () => needsLogin() || sessionLocked
function lockSession(reason) {
  if (!store.get().settings.security.pinHash || sessionLocked) return
  sessionLocked = true
  console.log(`[security] 잠금: ${reason}`)
  quick?.hide()
  broadcast()
}
let update = { checking: false, available: false } // 업데이트 상태 (화면 표시용)
let gclient = null
function googleClient() {
  const d = store.get()
  if (!d.account?.refreshEnc) return null
  if (!gclient) {
    const g = d.settings.google
    gclient = new google.GoogleClient({
      clientId: g.clientId,
      clientSecret: dec(g.clientSecretEnc) || g.clientSecretPlain,
      refreshToken: dec(d.account.refreshEnc),
    })
  }
  return gclient
}

// ── 키 관리: safeStorage(OS 키체인) 암호화 → 평문 폴백 → 환경변수/.env ─────────
function readDotenvKey() {
  for (const p of [path.join(ROOT, '..', '..', '.env'), path.join(ROOT, '..', '.env'), path.join(ROOT, '.env')]) {
    try {
      const m = fs.readFileSync(p, 'utf-8').match(/^\s*GOOGLE_API_KEY\s*=\s*["']?([^"'\r\n]+)/m)
      if (m) return m[1].trim()
    } catch {}
  }
  return ''
}

function getKey() {
  const s = store.get().settings
  if (s.geminiKeyEnc && safeStorage.isEncryptionAvailable()) {
    try {
      return { key: safeStorage.decryptString(Buffer.from(s.geminiKeyEnc, 'base64')), source: '앱 설정(암호화)' }
    } catch {}
  }
  if (s.geminiKeyPlain) return { key: s.geminiKeyPlain, source: '앱 설정' }
  if (process.env.GOOGLE_API_KEY) return { key: process.env.GOOGLE_API_KEY, source: '환경변수' }
  const env = TEST_HOOK ? '' : readDotenvKey() // 테스트 중엔 개발자 PC 의 .env 키를 읽지 않는다
  if (env) return { key: env, source: '.env 파일' }
  return { key: '', source: '' }
}

function setKey(key) {
  store.update((d) => {
    d.settings.geminiKeyEnc = ''
    d.settings.geminiKeyPlain = ''
    if (!key) return
    if (safeStorage.isEncryptionAvailable()) d.settings.geminiKeyEnc = safeStorage.encryptString(key).toString('base64')
    else d.settings.geminiKeyPlain = key
  })
}

// 엔진 결정: auto = Claude Code(노트북에 설치돼 있으면) → Gemini 키 → 규칙
function llm() {
  const s = store.get().settings
  const key = getKey().key
  const base = { key, model: s.geminiModel || 'gemini-2.5-flash', claudeCmd: process.env.NF_CLAUDE_CMD || s.claudeCmd, claudeModel: s.claudeModel }
  const engine = s.engine || 'auto'
  if (engine === 'off') return { ...base, provider: 'none' }
  if (engine === 'claude') return { ...base, provider: 'claude' }
  if (engine === 'gemini') return { ...base, provider: key ? 'gemini' : 'none' }
  return { ...base, provider: claudeVersion ? 'claude' : key ? 'gemini' : 'none' }
}

// ── 화면에 보낼 스냅샷 (비밀값 제외) ─────────────────────────────────────────
function snapshot() {
  const d = store.get()
  const { geminiKeyEnc, geminiKeyPlain, google: g, security: sec, ...settings } = d.settings
  const { pinHash, ...secPublic } = sec
  const k = getKey()
  const { clientSecretEnc, clientSecretPlain, ...gPublic } = g
  const base = {
    today: A.ymd(new Date()),
    platform: process.platform,
    locked: locked(),
    sessionLocked,
    needsLogin: needsLogin(),
    version: app.getVersion(),
    update: { ...update },
    privacy: !!d.settings.security.privacyMode,
    encrypted: store.encrypted,
    account: d.account ? { email: d.account.email, name: d.account.name, picture: d.account.picture } : null,
    busy: { ...busy },
    widgetMode,
  }
  const pub = {
    ...settings,
    google: { ...gPublic, hasSecret: !!(clientSecretEnc || clientSecretPlain) },
    security: { ...secPublic, hasPin: !!pinHash, canEncrypt: safeStorage.isEncryptionAvailable() },
    hasKey: !!k.key,
    keySource: k.source,
    claudeVersion,
    provider: providerOf(llm()),
  }
  // 잠겨 있으면 일정·활동 같은 개인 데이터는 화면에 보내지 않는다
  if (base.locked) return { ...base, settings: pub, profile: { domains: [] } }
  return {
    ...base,
    winDesktop: desktopPin ? desktopPin.status() : null,
    notes: (d.notes || []).slice(-50),
    settings: pub,
    profile: d.profile,
    events: d.events,
    activities: d.activities,
    remote: d.remote,
    doneMap: d.doneMap || {},
    brief: d.brief,
    english: d.english,
    englishHistory: (d.englishHistory || []).slice(-30),
    news: d.news,
    history: (d.history || []).slice(-60),
    coachTips: coachTips(),
  }
}

function broadcast() {
  for (const w of [widget, manager, quick]) if (w && !w.isDestroyed()) w.webContents.send('nf:changed')
}

function setBusy(job, on) {
  busy[job] = on
  broadcast()
}

async function withBusy(job, fn) {
  if (busy[job]) return
  setBusy(job, true)
  try {
    return await fn()
  } catch (e) {
    console.error(`[${job}]`, e)
  } finally {
    setBusy(job, false)
  }
}

function notify(title, body, view = 'today') {
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body, silent: false })
  n.on('click', () => openManager(view))
  n.show()
}

// ── Jobs ─────────────────────────────────────────────────────────────────────
function todayContext() {
  const d = store.get()
  const today = A.ymd(new Date())
  const todayAgenda = A.occurrences({ events: d.events, remote: d.remote.events, activities: d.activities }, today, today)
  const deadlines = A.deadlines({ events: d.events, activities: d.activities }, today)
  return { today, todayAgenda, deadlines }
}

function recordHistory(d, brief) {
  if (!brief) return
  d.history = (d.history || []).filter((h) => h.date !== brief.date)
  d.history.push({ date: brief.date, one_thing: brief.one_thing, done: !!brief.done })
  d.history = d.history.slice(-120)
}

async function runBrief(mode = 'daily') {
  return withBusy('brief', async () => {
    const ctx = todayContext()
    const brief = await brain.makeBrief(store.get(), llm(), { ...ctx, mode })
    store.update((d) => {
      // 같은 날 같은 '단 하나'면 완료 상태를 유지
      if (d.brief && d.brief.date === brief.date && d.brief.one_thing === brief.one_thing) brief.done = d.brief.done
      d.brief = brief
      recordHistory(d, brief)
      if (mode === 'weekly' && Array.isArray(brief.recommendations)) {
        const names = new Set(d.activities.map((a) => a.name))
        for (const r of brief.recommendations) {
          if (!r.name || names.has(r.name)) continue
          d.activities.push({
            id: uid(),
            name: r.name,
            domain: r.domain || '',
            priority: r.priority || '중간',
            energy: r.energy || '가벼움',
            repeat: '1회',
            min: Number(r.min) || null,
            date: null,
            status: '제안됨', // 승인 게이트: 사용자가 보드에서 승인해야 일정이 된다
            why: r.why || '',
          })
        }
      }
    })
    return brief
  })
}

async function runEnglish() {
  return withBusy('english', async () => {
    const ctx = todayContext()
    const english = await brain.makeEnglish(store.get(), llm(), { ...ctx, brief: store.get().brief })
    store.update((d) => {
      d.english = english
      d.englishHistory = [...(d.englishHistory || []).filter((h) => h.date !== english.date), english].slice(-60)
    })
  })
}

async function runNews() {
  return withBusy('news', async () => {
    const { items, errors, fetchedAt } = await pullNews(store.get().settings.feeds || [])
    const summary = await brain.summarizeNews(store.get(), llm(), items)
    store.update((d) => {
      d.news = { items, errors, fetchedAt, summary: summary || d.news?.summary || null }
    })
  })
}

// 구글 캘린더(로그인) + ICS 주소(선택)를 합쳐 remote 로
async function runCalendar() {
  return withBusy('calendar', async () => {
    const s = store.get().settings
    const remote = await pullRemote(s.icsUrls || [])
    const gc = googleClient()
    if (gc) {
      try {
        const cals = await gc.calendars()
        const chosen = s.google.calendarIds ? cals.filter((c) => s.google.calendarIds.includes(c.id)) : cals.filter((c) => c.selected)
        const now = new Date()
        const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 45)
        const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 150)
        const g = await gc.events(chosen, from, to)
        remote.events.push(...g.events)
        remote.errors.push(...g.errors.map((e) => ({ url: e.calendar, message: e.message })))
        remote.calendars = cals
      } catch (e) {
        remote.errors.push({ url: 'Google', message: e.message })
      }
    }
    store.update((d) => (d.remote = remote))
  })
}

// ── 코칭 ─────────────────────────────────────────────────────────────────────
function coachContext() {
  const d = store.get()
  const today = A.ymd(new Date())
  const occ = A.occurrences({ events: d.events, remote: d.remote.events, activities: d.activities, doneMap: d.doneMap || {} }, today, A.addDays(today, 6))
  const deadlines = A.deadlines({ events: d.events, activities: d.activities }, today)
  return { occ, deadlines, today, coach: d.settings.coach }
}

function coachTips() {
  const now = new Date()
  try {
    return coach.tips({ ...coachContext(), nowMin: now.getHours() * 60 + now.getMinutes() })
  } catch (e) {
    console.error('[coach]', e)
    return []
  }
}

async function askCoach(question) {
  const q = String(question || '').replace(/^\s*[?？]/, '').trim()
  if (!q) return null
  return withBusy('coach', async () => {
    const r = await coach.ask(q, { ...coachContext(), now: new Date(), brief: store.get().brief, llm: llm() })
    store.update((x) => (x.inbox = [...(x.inbox || []), { at: new Date().toISOString(), kind: 'ask', title: q, result: r.answer.slice(0, 200) }].slice(-100)))
    return r
  })
}

// ── 언제든 입력: 미리보기 → 확인 → 실행 ──────────────────────────────────────
async function previewInput(text) {
  const t = String(text || '').trim()
  if (!t) return null
  return withBusy('input', () => interpret(t, { today: A.ymd(new Date()), llm: llm(), profile: store.get().profile }))
}

function endOf(start, minutes) {
  if (!start || !minutes) return null
  const e = google.addMinutes(start, Number(minutes))
  return typeof e === 'string' ? e : null // 자정을 넘기면 끝 시각은 비워 둔다
}

async function commitInput(item) {
  const today = A.ymd(new Date())
  const d = store.get()
  const log = (msg) =>
    store.update((x) => (x.inbox = [...(x.inbox || []), { at: new Date().toISOString(), kind: item.kind, title: item.title, result: msg }].slice(-100)))
  if (item.kind === 'one_thing') {
    store.update((x) => {
      x.brief = { ...(x.brief && x.brief.date === today ? x.brief : { date: today, mode: 'daily' }), one_thing: item.title, done: false, source: 'manual' }
      recordHistory(x, x.brief)
    })
    log('오늘의 단 하나로 정함')
    return { ok: true, message: '오늘의 단 하나로 정했어요' }
  }
  if (item.kind === 'note') {
    store.update((x) => (x.notes = [...(x.notes || []), { id: uid(), at: new Date().toISOString(), text: item.title }]))
    log('메모 저장')
    return { ok: true, message: '메모했어요' }
  }
  if (item.kind === 'task') {
    store.update((x) =>
      x.activities.push({ id: uid(), name: item.title, domain: item.domain || '', priority: '중간', energy: '가벼움', repeat: '1회', min: item.minutes || null, date: item.date || null, start: item.start || null, status: item.date ? '예정됨' : '승인됨', why: '빠른 입력' })
    )
    log('활동 보드에 추가')
    return { ok: true, message: '활동 보드에 추가했어요' }
  }
  // event: 로그인돼 있으면 구글 캘린더, 아니면 앱 안 일정
  const ev = { title: item.title, date: item.date || today, start: item.start || null, minutes: item.minutes || 60, note: '' }
  const gc = item.target !== 'local' && googleClient()
  if (gc) {
    try {
      await gc.createEvent(d.settings.google.defaultCalendar || 'primary', ev, Intl.DateTimeFormat().resolvedOptions().timeZone)
      log('구글 캘린더에 추가')
      runCalendar()
      return { ok: true, message: '구글 캘린더에 추가했어요' }
    } catch (e) {
      log(`구글 실패 → 앱에 저장: ${e.message}`)
    }
  }
  store.update((x) =>
    x.events.push({ id: uid(), title: ev.title, date: ev.date, start: ev.start, end: endOf(ev.start, item.minutes), domain: item.domain || '', note: '', repeat: null, deadline: false, source: 'local' })
  )
  log('앱 일정에 추가')
  return { ok: true, message: gc ? '구글 저장에 실패해 앱 일정에 넣었어요' : '일정에 추가했어요' }
}

const jobs = {
  async morning() {
    const brief = await runBrief('daily')
    await runEnglish()
    if (brief) notify('🌊 오늘의 단 하나', brief.one_thing)
  },
  async weekly() {
    await runBrief('weekly')
    notify('🗓️ 주간 추천이 도착했어', '활동 보드에서 이번 주 할 일을 승인해 줘.', 'board')
  },
  checkin() {
    const b = store.get().brief
    if (b && b.date === A.ymd(new Date()) && !b.done) {
      notify('🌙 저녁 체크인', `오늘의 단 하나 했어? — ${b.one_thing}`)
    }
  },
  news: runNews,
  calendar: runCalendar,
  onNewDay: () => broadcast(),
}

// ── 위젯 창 ──────────────────────────────────────────────────────────────────
function widgetBounds(height = 640) {
  const w = store.get().settings.widget
  const width = Math.max(300, Math.min(520, Number(w.width) || 360))
  let x = w.x
  let y = w.y
  const display = x == null ? screen.getPrimaryDisplay() : screen.getDisplayMatching({ x, y, width, height })
  const wa = display.workArea
  if (x == null || x < wa.x - width + 40 || x > wa.x + wa.width - 40) x = wa.x + wa.width - width - 28
  if (y == null || y < wa.y || y > wa.y + wa.height - 80) y = wa.y + 28
  return { x, y, width, height: Math.min(height, wa.height - (y - wa.y) - 8) }
}

function createWidget() {
  const pinned = widgetMode === 'pinned'
  const prev = widget
  const opts = {
    ...widgetBounds(prev && !prev.isDestroyed() ? prev.getBounds().height : 640),
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    alwaysOnTop: !pinned, // 편집 모드에서만 위로 띄워서 옮기기 쉽게
    title: 'neural-flow',
    backgroundColor: '#00000000',
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, backgroundThrottling: false },
  }
  if (pinned) {
    // Windows: 포커스를 받지 않는 창 → 클릭해도 다른 창 위로 올라오지 않는다(=바탕화면에 머무름).
    // macOS/Linux: 'desktop' 타입 = 바탕화면 레벨에 고정 (단, 마우스 입력은 받지 않음 → 편집 모드로 조작).
    if (IS_WIN) opts.focusable = false
    else opts.type = 'desktop'
  }
  desktopPin?.stop()
  desktopPin = null
  widget = new BrowserWindow(opts)
  protect(widget)
  if (IS_MAC) widget.setVisibleOnAllWorkspaces(true)
  widget.loadFile(path.join(ROOT, 'renderer', 'widget', 'index.html'))
  widget.once('ready-to-show', () => {
    if (store.get().settings.widget.visible !== false) widget.showInactive()
    applyClickThrough()
    // Windows: Win+D(바탕화면 보기)에도 위젯이 남도록
    if (IS_WIN && pinned) desktopPin = pinToDesktop(widget)
  })
  widget.on('moved', () => {
    const { x, y } = widget.getBounds()
    store.update((d) => Object.assign(d.settings.widget, { x, y }))
  })
  widget.on('closed', () => {
    if (widget && widget.isDestroyed()) widget = null
  })
  if (prev && !prev.isDestroyed()) prev.destroy()
}

function applyClickThrough() {
  if (!widget || widget.isDestroyed()) return
  const on = widgetMode === 'pinned' && !!store.get().settings.widget.clickThrough
  widget.setIgnoreMouseEvents(on, { forward: true })
}

function setWidgetMode(mode) {
  if (mode === widgetMode) return
  widgetMode = mode
  createWidget()
  buildTray()
}

function toggleWidgetVisible() {
  const visible = !(store.get().settings.widget.visible !== false)
  store.update((d) => (d.settings.widget.visible = visible))
  if (!widget || widget.isDestroyed()) createWidget()
  else if (visible) widget.showInactive()
  else widget.hide()
  buildTray()
}

// ── 관리 창 ──────────────────────────────────────────────────────────────────
function openManager(view) {
  if (manager && !manager.isDestroyed()) {
    if (view) manager.webContents.send('nf:navigate', view)
    manager.show()
    manager.focus()
    return
  }
  manager = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 620,
    show: false,
    title: 'neural-flow',
    icon: path.join(ROOT, 'assets', 'icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111113' : '#fcfcfd',
    autoHideMenuBar: true,
    ...(IS_MAC ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 } } : {}),
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true },
  })
  protect(manager)
  manager.loadFile(path.join(ROOT, 'renderer', 'app', 'index.html'), { hash: view || 'today' })
  manager.once('ready-to-show', () => manager.show())
  manager.on('closed', () => (manager = null))
}

// ── 빠른 입력 창 (Spotlight 처럼) ────────────────────────────────────────────
function toggleQuick() {
  if (quick && !quick.isDestroyed() && quick.isVisible()) return quick.hide()
  if (!quick || quick.isDestroyed()) {
    const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    quick = new BrowserWindow({
      width: 640,
      height: 460,
      x: Math.round(wa.x + (wa.width - 640) / 2),
      y: Math.round(wa.y + wa.height * 0.18),
      frame: false,
      transparent: true,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true },
    })
    protect(quick)
    quick.loadFile(path.join(ROOT, 'renderer', 'quick', 'index.html'))
    quick.on('blur', () => !TEST_HOOK && quick?.hide())
    quick.on('closed', () => (quick = null))
    quick.once('ready-to-show', () => quick.show())
    return
  }
  quick.show()
  quick.focus()
  quick.webContents.send('nf:navigate', 'focus')
}

// ── 트레이 ───────────────────────────────────────────────────────────────────
function trayImage() {
  const file = IS_MAC ? 'trayTemplate.png' : 'tray.png'
  const img = nativeImage.createFromPath(path.join(ROOT, 'assets', file))
  if (IS_MAC) img.setTemplateImage(true)
  return img
}

function buildTray() {
  if (!tray) {
    tray = new Tray(trayImage())
    tray.setToolTip('neural-flow')
    tray.on('click', () => (IS_MAC ? tray.popUpContextMenu() : openManager()))
  }
  const s = store.get().settings
  const shortcut = IS_MAC ? '⌘⌥N' : 'Ctrl+Alt+N'
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `빠른 입력 (${IS_MAC ? '⌘⇧Space' : 'Ctrl+Shift+Space'})`, click: toggleQuick },
      { label: '열기 (오늘)', click: () => openManager('today') },
      { label: '캘린더', click: () => openManager('calendar') },
      { label: '활동 보드', click: () => openManager('board') },
      { type: 'separator' },
      { label: s.widget.visible !== false ? '위젯 숨기기' : '위젯 보이기', click: toggleWidgetVisible },
      {
        label: widgetMode === 'edit' ? `위젯 고정하기 (${shortcut})` : `위젯 편집·이동 (${shortcut})`,
        click: () => setWidgetMode(widgetMode === 'edit' ? 'pinned' : 'edit'),
      },
      {
        label: '위젯 클릭 통과',
        type: 'checkbox',
        checked: !!s.widget.clickThrough,
        click: (item) => {
          store.update((d) => (d.settings.widget.clickThrough = item.checked))
          applyClickThrough()
        },
      },
      { type: 'separator' },
      { label: '지금 브리핑 만들기', click: () => jobs.morning() },
      { label: '뉴스 새로고침', click: () => runNews() },
      { type: 'separator' },
      ...(update.available ? [{ label: `업데이트 ${update.version} 설치`, click: () => installUpdate() }] : []),
      {
        label: `가리기 모드 (${IS_MAC ? '⌘⌥P' : 'Ctrl+Alt+P'})`,
        type: 'checkbox',
        checked: !!s.security.privacyMode,
        click: () => togglePrivacy(),
      },
      ...(s.security.pinHash ? [{ label: '지금 잠그기', click: () => lockSession('트레이') }] : []),
      { label: '종료', role: 'quit' },
    ])
  )
}

// ── 보안 ─────────────────────────────────────────────────────────────────────
function protect(win) {
  // 화면 공유·캡처(Zoom·디스코드·캡처 도구)에 이 창이 찍히지 않게 (Windows·macOS)
  if (win && !win.isDestroyed()) win.setContentProtection(!!store.get().settings.security.contentProtection && !TEST_HOOK)
}
function togglePrivacy() {
  store.update((d) => (d.settings.security.privacyMode = !d.settings.security.privacyMode))
  buildTray()
}
function hardenSession() {
  // 카메라·마이크·위치·알림 외 권한 요청은 모두 거절 (앱은 아무 권한도 필요 없다)
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
}
function startSecurityWatch() {
  powerMonitor.on('lock-screen', () => store.get().settings.security.lockOnScreenLock && lockSession('화면 잠금'))
  powerMonitor.on('suspend', () => store.get().settings.security.lockOnScreenLock && lockSession('절전'))
  setInterval(() => {
    const min = Number(store.get().settings.security.idleLockMinutes) || 0
    if (min > 0 && powerMonitor.getSystemIdleTime() >= min * 60) lockSession('자리 비움')
  }, 30000)
}

// ── 업데이트 ─────────────────────────────────────────────────────────────────
let notifiedVersion = ''
async function checkUpdate({ manual = false } = {}) {
  update = { ...update, checking: true, error: '' }
  broadcast()
  try {
    const r = await updater.check(app.getVersion())
    update = { ...r, checking: false }
    const skip = store.get().settings.updates.skipVersion
    if (r.available && r.version !== notifiedVersion && (manual || r.version !== skip)) {
      notifiedVersion = r.version
      notify(`⬆️ neural-flow ${r.version} 업데이트`, '설정 또는 트레이에서 한 번에 설치할 수 있어요', 'settings')
    }
  } catch (e) {
    update = { ...update, checking: false, error: e.message }
  }
  broadcast()
  buildTray()
  return update
}
function startUpdateWatch() {
  if (TEST_HOOK) return
  const run = () => store.get().settings.updates.autoCheck && checkUpdate()
  setTimeout(run, 15000)
  setInterval(run, 6 * 3600 * 1000)
}
async function installUpdate() {
  if (!update.available || !update.asset) return { ok: false, message: '받을 업데이트가 없어요' }
  if (!app.isPackaged && !process.env.NF_UPDATE_DRYRUN) return { ok: false, message: '개발 실행 중이에요 — git pull 로 업데이트하세요' }
  try {
    update = { ...update, downloading: 0 }
    broadcast()
    const got = await updater.download(update.asset, (p) => {
      update.downloading = Math.round(p * 100)
      broadcast()
    })
    update = { ...update, downloading: null, verified: got.verified, file: got.file }
    if (process.env.NF_UPDATE_DRYRUN) {
      broadcast()
      return { ok: true, dryRun: true, verified: got.verified, sha256: got.sha256 }
    }
    store.flush()
    updater.install(got.file, { appPath: IS_MAC ? path.resolve(app.getAppPath(), '..', '..', '..') : undefined })
    setTimeout(() => app.exit(0), 500)
    return { ok: true }
  } catch (e) {
    update = { ...update, downloading: null, error: e.message }
    broadcast()
    return { ok: false, message: e.message }
  }
}

// ── IPC ──────────────────────────────────────────────────────────────────────
function registerIpc() {
  // 잠겨 있을 때도 쓸 수 있는 채널만 열어 두고, 나머지는 로그인 전 거부
  const OPEN = new Set(['nf:security:unlock', 'nf:update:check', 'nf:snapshot', 'nf:auth:signin', 'nf:auth:config', 'nf:auth:simple', 'nf:open', 'nf:link', 'nf:widget:resize', 'nf:quick:hide', 'nf:quick:open'])
  const handle = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = (ch, fn) =>
    handle(ch, (...args) => {
      if (!OPEN.has(ch) && locked()) throw new Error('로그인이 필요해요')
      return fn(...args)
    })

  ipcMain.handle('nf:snapshot', () => snapshot())

  // PIN 해제 — 5번 틀리면 30초 대기
  let fails = 0
  let waitUntil = 0
  ipcMain.handle('nf:security:unlock', (_e, pin) => {
    if (Date.now() < waitUntil) return { ok: false, message: `잠시 후 다시 시도하세요 (${Math.ceil((waitUntil - Date.now()) / 1000)}초)` }
    if (security.verifyPin(String(pin || ''), store.get().settings.security.pinHash)) {
      fails = 0
      sessionLocked = false
      broadcast()
      return { ok: true }
    }
    fails++
    if (fails >= 5) {
      waitUntil = Date.now() + 30000
      fails = 0
    }
    return { ok: false, message: 'PIN 이 맞지 않아요' }
  })
  ipcMain.handle('nf:security:set-pin', (_e, pin) => {
    const p = String(pin || '')
    if (p && !/^\d{4,8}$/.test(p)) return { ok: false, message: 'PIN 은 숫자 4~8자리' }
    store.update((d) => (d.settings.security.pinHash = p ? security.hashPin(p) : ''))
    buildTray()
    return { ok: true }
  })
  ipcMain.handle('nf:security:lock', () => lockSession('직접'))
  ipcMain.handle('nf:security:privacy', () => togglePrivacy())
  ipcMain.handle('nf:security:apply', () => [widget, manager, quick].forEach(protect))
  ipcMain.handle('nf:data:export', async () => {
    const r = await dialog.showSaveDialog(manager || undefined, { defaultPath: `neural-flow-백업-${A.ymd(new Date())}.json` })
    if (r.canceled || !r.filePath) return { ok: false }
    const { settings, account, ...rest } = store.get()
    const { geminiKeyEnc, geminiKeyPlain, google, security: sec, ...safeSettings } = settings
    fs.writeFileSync(r.filePath, JSON.stringify({ exportedAt: new Date().toISOString(), settings: safeSettings, ...rest }, null, 2), { mode: 0o600 })
    return { ok: true, path: r.filePath }
  })
  ipcMain.handle('nf:data:wipe', async () => {
    // 구글 토큰 폐기 → 데이터 파일 삭제 → 다시 시작
    const refresh = dec(store.get().account?.refreshEnc)
    if (refresh) await fetch(`${process.env.NF_GOOGLE_REVOKE || 'https://oauth2.googleapis.com/revoke'}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `token=${encodeURIComponent(refresh)}` }).catch(() => {})
    try {
      fs.rmSync(store.file, { force: true })
    } catch {}
    if (TEST_HOOK) return { ok: true }
    app.relaunch()
    app.exit(0)
  })
  ipcMain.handle('nf:update:check', () => checkUpdate({ manual: true }))
  ipcMain.handle('nf:update:install', () => installUpdate())
  ipcMain.handle('nf:update:skip', () => store.update((d) => (d.settings.updates.skipVersion = update.version || '')))

  // 로그인 설정(클라이언트 ID/시크릿)은 잠금 화면에서 입력한다
  ipcMain.handle('nf:auth:config', (_e, { clientId, clientSecret } = {}) => {
    store.update((d) => {
      if (clientId !== undefined) d.settings.google.clientId = String(clientId).trim()
      if (clientSecret !== undefined) {
        const v = enc(String(clientSecret).trim())
        d.settings.google.clientSecretEnc = v
        d.settings.google.clientSecretPlain = ''
      }
    })
    gclient = null
  })
  // 간편 모드: 로그인 없이 iCal 주소로 구글 캘린더를 읽기만 한다
  ipcMain.handle('nf:auth:simple', async (_e, icsUrl) => {
    const url = String(icsUrl || '').trim()
    if (!/^(https?|webcal):\/\//i.test(url)) return { ok: false, message: 'iCal 주소(https://…ics)를 붙여넣어 주세요' }
    store.update((d) => {
      d.settings.requireLogin = false
      d.settings.icsUrls = [...new Set([...(d.settings.icsUrls || []), url])]
    })
    await runCalendar()
    const n = (store.get().remote.events || []).length
    return { ok: true, count: n }
  })
  ipcMain.handle('nf:auth:signin', async () => {
    const g = store.get().settings.google
    setBusy('signin', true)
    try {
      const r = await google.signIn({
        clientId: g.clientId,
        clientSecret: dec(g.clientSecretEnc) || g.clientSecretPlain,
        allowedEmails: g.allowedEmails,
        openUrl: (url) => (TEST_HOOK && process.env.NF_TEST_OPEN_URL === 'fetch' ? fetch(url).catch(() => {}) : shell.openExternal(url)),
      })
      store.update((d) => {
        d.account = { email: r.email, name: r.name, picture: r.picture, refreshEnc: enc(r.refreshToken) }
        if (!d.settings.google.allowedEmails?.length) d.settings.google.allowedEmails = [r.email] // 첫 로그인 계정을 주인으로
      })
      gclient = new google.GoogleClient({ clientId: g.clientId, clientSecret: dec(g.clientSecretEnc) || g.clientSecretPlain, refreshToken: r.refreshToken, accessToken: r.accessToken, expiresAt: r.expiresAt })
      runCalendar()
      return { ok: true, email: r.email }
    } catch (e) {
      return { ok: false, message: e.message }
    } finally {
      setBusy('signin', false)
    }
  })
  ipcMain.handle('nf:auth:signout', () => {
    gclient = null
    store.update((d) => {
      d.account = null
      d.remote = { ...d.remote, events: (d.remote.events || []).filter((e) => e.source !== 'google') }
    })
  })

  ipcMain.handle('nf:input:preview', (_e, text) => previewInput(text))
  ipcMain.handle('nf:input:commit', (_e, item) => commitInput(item))
  ipcMain.handle('nf:coach:ask', (_e, q) => askCoach(q))
  ipcMain.handle('nf:quick:hide', () => quick?.hide())
  ipcMain.handle('nf:quick:open', () => toggleQuick())
  ipcMain.handle('nf:google:delete', async (_e, calendarId, eventId) => {
    await googleClient()?.deleteEvent(calendarId, eventId)
    await runCalendar()
  })
  ipcMain.handle('nf:engine:detect', async () => {
    claudeVersion = await detectClaude(process.env.NF_CLAUDE_CMD || store.get().settings.claudeCmd)
    broadcast()
    return claudeVersion
  })

  ipcMain.handle('nf:event:save', (_e, ev) => {
    store.update((d) => {
      const clean = {
        id: ev.id || uid(),
        title: String(ev.title || '').trim() || '(제목 없음)',
        date: ev.date,
        start: ev.start || null,
        end: ev.end || null,
        domain: ev.domain || '',
        note: ev.note || '',
        repeat: ev.repeat || null,
        until: ev.until || null,
        deadline: !!ev.deadline,
        source: 'local',
      }
      const i = d.events.findIndex((x) => x.id === clean.id)
      if (i >= 0) d.events[i] = clean
      else d.events.push(clean)
    })
  })
  ipcMain.handle('nf:event:delete', (_e, id) => store.update((d) => (d.events = d.events.filter((x) => x.id !== id))))

  ipcMain.handle('nf:activity:save', (_e, a) => {
    store.update((d) => {
      const clean = {
        id: a.id || uid(),
        name: String(a.name || '').trim() || '(이름 없음)',
        domain: a.domain || '',
        priority: a.priority || '중간',
        energy: a.energy || '가벼움',
        repeat: a.repeat || '1회',
        min: a.min ? Number(a.min) : null,
        date: a.date || null,
        start: a.start || null,
        status: a.status || '제안됨',
        why: a.why || '',
      }
      // 날짜를 잡으면 '예정됨'으로 (승인 → 캘린더 배치)
      if (clean.date && (clean.status === '제안됨' || clean.status === '승인됨')) clean.status = '예정됨'
      const i = d.activities.findIndex((x) => x.id === clean.id)
      if (i >= 0) d.activities[i] = clean
      else d.activities.push(clean)
    })
  })
  ipcMain.handle('nf:activity:delete', (_e, id) =>
    store.update((d) => (d.activities = d.activities.filter((x) => x.id !== id)))
  )
  // 날짜가 지난 미완료 활동 → 보류 (지우지 않는다)
  ipcMain.handle('nf:activity:archive-stale', () => {
    const today = A.ymd(new Date())
    let n = 0
    store.update((d) => {
      for (const a of d.activities)
        if (a.date && a.date < today && a.status !== '완료' && a.status !== '보류') {
          a.status = '보류'
          n++
        }
    })
    return n
  })
  ipcMain.handle('nf:activity:status', (_e, id, status) =>
    store.update((d) => {
      const a = d.activities.find((x) => x.id === id)
      if (a) a.status = status
    })
  )

  // 캘린더 항목 완료 토글 (로컬 일정은 날짜별, 활동은 상태로)
  ipcMain.handle('nf:occurrence:toggle', (_e, key) =>
    store.update((d) => {
      if (key.startsWith('a:')) {
        const a = d.activities.find((x) => x.id === key.slice(2))
        if (a) a.status = a.status === '완료' ? '예정됨' : '완료'
        return
      }
      d.doneMap = d.doneMap || {}
      if (d.doneMap[key]) delete d.doneMap[key]
      else d.doneMap[key] = true
    })
  )

  ipcMain.handle('nf:onething:toggle', () =>
    store.update((d) => {
      if (!d.brief) return
      d.brief.done = !d.brief.done
      recordHistory(d, d.brief)
    })
  )
  ipcMain.handle('nf:onething:set', (_e, text) =>
    store.update((d) => {
      const today = A.ymd(new Date())
      d.brief = { ...(d.brief && d.brief.date === today ? d.brief : { date: today, mode: 'daily' }), one_thing: text, done: false, source: 'manual' }
      recordHistory(d, d.brief)
    })
  )

  ipcMain.handle('nf:run', (_e, job) => {
    const map = { brief: () => runBrief('daily'), weekly: () => runBrief('weekly'), english: runEnglish, news: runNews, calendar: runCalendar }
    return map[job] ? map[job]() : null
  })

  ipcMain.handle('nf:settings:save', (_e, patch = {}) => {
    const icsBefore = JSON.stringify(store.get().settings.icsUrls) // 값으로 복사 (객체는 아래에서 바뀜)
    store.update((d) => {
      const { widget: w, schedule: sc, google: g, security: sec, updates: up, coach: co, geminiKeyEnc, geminiKeyPlain, ...rest } = patch
      if (sec) {
        const { pinHash, hasPin, canEncrypt, ...safe } = sec // PIN 은 nf:security:set-pin 으로만
        Object.assign(d.settings.security, safe)
      }
      if (up) Object.assign(d.settings.updates, up)
      if (co) Object.assign(d.settings.coach, co)
      Object.assign(d.settings, rest)
      if (w) Object.assign(d.settings.widget, w)
      if (sc) Object.assign(d.settings.schedule, sc)
      if (g) {
        const { clientSecretEnc, clientSecretPlain, hasSecret, ...safe } = g // 시크릿은 nf:auth:config 로만
        Object.assign(d.settings.google, safe)
      }
    })
    const after = store.get().settings
    if (patch.widget?.theme) nativeTheme.themeSource = after.widget.theme === 'auto' ? 'system' : after.widget.theme
    if (patch.widget && 'width' in patch.widget) createWidget()
    if (patch.widget && 'clickThrough' in patch.widget) applyClickThrough()
    if (patch.security && 'contentProtection' in patch.security) [widget, manager, quick].forEach(protect)
    if (patch.security && 'encryptData' in patch.security) store.flush()
    if ('autoStart' in patch) applyAutoStart()
    if (icsBefore !== JSON.stringify(after.icsUrls) || patch.google?.calendarIds !== undefined) runCalendar()
    if (patch.engine || patch.claudeCmd) detectClaude(process.env.NF_CLAUDE_CMD || after.claudeCmd).then((v) => ((claudeVersion = v), broadcast()))
    buildTray()
  })

  ipcMain.handle('nf:key:set', async (_e, key) => {
    setKey(String(key || '').trim())
    if (!key) return { ok: true }
    try {
      await brain.testKey({ ...llm(), provider: 'gemini' }) // 키 테스트는 항상 Gemini 로
      return { ok: true }
    } catch (e) {
      return { ok: false, message: e.message }
    }
  })

  ipcMain.handle('nf:open', (_e, view) => openManager(view))
  ipcMain.handle('nf:link', (_e, url) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
  })
  ipcMain.handle('nf:widget:resize', (e, height) => {
    if (!widget || widget.isDestroyed() || e.sender !== widget.webContents) return
    const b = widgetBounds(Math.ceil(height))
    widget.setBounds({ ...widget.getBounds(), height: b.height })
  })
  ipcMain.handle('nf:widget:mode', (_e, mode) => setWidgetMode(mode))
}

function applyAutoStart() {
  const on = !!store.get().settings.autoStart
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: on })
  else if (IS_WIN) app.setLoginItemSettings({ openAtLogin: on, path: process.execPath, args: [app.getAppPath()] })
}

// ── 시작 ─────────────────────────────────────────────────────────────────────
app.on('second-instance', () => openManager())
app.on('window-all-closed', () => {}) // 창을 모두 닫아도 트레이에 상주
app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('web-contents-created', (_e, wc) => {
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  wc.on('will-navigate', (ev) => ev.preventDefault())
})

app.whenReady().then(async () => {
  if (IS_MAC) app.dock?.hide()
  // 저장 파일 암호화 (OS 키체인). 안 되는 환경(키링 없는 Linux 등)에서는 평문 + 권한 600
  const cipher = safeStorage.isEncryptionAvailable()
    ? { encrypt: (str) => safeStorage.encryptString(str), decrypt: (buf) => safeStorage.decryptString(buf) }
    : null
  store = new Store(process.env.NF_DATA_DIR || app.getPath('userData'), { cipher }).load()
  store.flush() // 옛 평문 파일이면 바로 암호화
  applyBuildConfig()
  hardenSession()
  if (store.get().settings.security.pinHash) sessionLocked = true // 켤 때마다 PIN
  const theme = store.get().settings.widget.theme
  nativeTheme.themeSource = theme === 'auto' ? 'system' : theme

  registerIpc()
  store.onChange(broadcast)
  createWidget()
  buildTray()
  applyAutoStart()
  startSecurityWatch()
  startUpdateWatch()

  globalShortcut.register('CommandOrControl+Alt+N', () => setWidgetMode(widgetMode === 'edit' ? 'pinned' : 'edit'))
  globalShortcut.register('CommandOrControl+Alt+M', () => openManager())
  globalShortcut.register('CommandOrControl+Alt+P', () => togglePrivacy())
  try {
    globalShortcut.register(store.get().settings.quickShortcut || 'CommandOrControl+Shift+Space', toggleQuick)
  } catch (e) {
    console.warn('[quick] 단축키 등록 실패:', e.message)
  }
  // Claude Code 가 깔려 있는지 확인 (엔진 auto 일 때 우선 사용)
  detectClaude(process.env.NF_CLAUDE_CMD || store.get().settings.claudeCmd).then((v) => {
    claudeVersion = v
    broadcast()
  })

  // 잠겨 있는 동안(로그인 전)에는 자동 작업·알림을 돌리지 않는다
  const lockedJobs = Object.fromEntries(Object.entries(jobs).map(([k, fn]) => [k, (...a) => (locked() ? undefined : fn(...a))]))
  const scheduler = createScheduler(store, lockedJobs)
  if (!TEST_HOOK) scheduler.start()
  // 절전 복귀·화면 구성 변경 시 날짜/위치 갱신
  powerMonitor.on('resume', () => scheduler.tick())
  screen.on('display-removed', () => createWidget())

  if (DEV || locked()) openManager('today')
  if (TEST_HOOK) require(path.resolve(TEST_HOOK)).run({ app, store, getWidget: () => widget, openManager, getManager: () => manager, setWidgetMode, jobs, toggleQuick, getQuick: () => quick })
})
