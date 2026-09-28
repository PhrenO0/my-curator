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
} = require('electron')

const { Store, uid } = require('./store.js')
const A = require('../renderer/shared/agenda.js')
const brain = require('./brain.js')
const { pullRemote } = require('./calendar.js')
const { pullNews } = require('./news.js')
const { createScheduler } = require('./scheduler.js')

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
let widgetMode = 'pinned' // pinned(바탕화면 고정) | edit(이동·상호작용)
const busy = {}

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

function llm() {
  return { key: getKey().key, model: store.get().settings.geminiModel || 'gemini-2.5-flash' }
}

// ── 화면에 보낼 스냅샷 (비밀값 제외) ─────────────────────────────────────────
function snapshot() {
  const d = store.get()
  const { geminiKeyEnc, geminiKeyPlain, ...settings } = d.settings
  const k = getKey()
  return {
    today: A.ymd(new Date()),
    platform: process.platform,
    widgetMode,
    busy: { ...busy },
    settings: { ...settings, hasKey: !!k.key, keySource: k.source },
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
  }
}

function broadcast() {
  for (const w of [widget, manager]) if (w && !w.isDestroyed()) w.webContents.send('nf:changed')
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

async function runCalendar() {
  return withBusy('calendar', async () => {
    const urls = store.get().settings.icsUrls || []
    const remote = await pullRemote(urls)
    store.update((d) => (d.remote = remote))
  })
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
  widget = new BrowserWindow(opts)
  if (IS_MAC) widget.setVisibleOnAllWorkspaces(true)
  widget.loadFile(path.join(ROOT, 'renderer', 'widget', 'index.html'))
  widget.once('ready-to-show', () => {
    if (store.get().settings.widget.visible !== false) widget.showInactive()
    applyClickThrough()
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
  manager.loadFile(path.join(ROOT, 'renderer', 'app', 'index.html'), { hash: view || 'today' })
  manager.once('ready-to-show', () => manager.show())
  manager.on('closed', () => (manager = null))
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
      { label: '종료', role: 'quit' },
    ])
  )
}

// ── IPC ──────────────────────────────────────────────────────────────────────
function registerIpc() {
  ipcMain.handle('nf:snapshot', () => snapshot())

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
      const { widget: w, schedule: sc, ...rest } = patch
      Object.assign(d.settings, rest)
      if (w) Object.assign(d.settings.widget, w)
      if (sc) Object.assign(d.settings.schedule, sc)
    })
    const after = store.get().settings
    if (patch.widget?.theme) nativeTheme.themeSource = after.widget.theme === 'auto' ? 'system' : after.widget.theme
    if (patch.widget && 'width' in patch.widget) createWidget()
    if (patch.widget && 'clickThrough' in patch.widget) applyClickThrough()
    if ('autoStart' in patch) applyAutoStart()
    if (icsBefore !== JSON.stringify(after.icsUrls)) runCalendar()
    buildTray()
  })

  ipcMain.handle('nf:key:set', async (_e, key) => {
    setKey(String(key || '').trim())
    if (!key) return { ok: true }
    try {
      await brain.testKey(llm())
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
  store = new Store(process.env.NF_DATA_DIR || app.getPath('userData')).load()
  const theme = store.get().settings.widget.theme
  nativeTheme.themeSource = theme === 'auto' ? 'system' : theme

  registerIpc()
  store.onChange(broadcast)
  createWidget()
  buildTray()
  applyAutoStart()

  globalShortcut.register('CommandOrControl+Alt+N', () => setWidgetMode(widgetMode === 'edit' ? 'pinned' : 'edit'))
  globalShortcut.register('CommandOrControl+Alt+M', () => openManager())

  const scheduler = createScheduler(store, jobs)
  if (!TEST_HOOK) scheduler.start()
  // 절전 복귀·화면 구성 변경 시 날짜/위치 갱신
  powerMonitor.on('resume', () => scheduler.tick())
  screen.on('display-removed', () => createWidget())

  if (DEV) openManager('today')
  if (TEST_HOOK) require(path.resolve(TEST_HOOK)).run({ app, store, getWidget: () => widget, openManager, getManager: () => manager, setWidgetMode, jobs })
})
