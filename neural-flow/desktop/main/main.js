// neural-flow desktop — Notion Command Center 의 "📅 앞으로 7일" 보드를 바탕화면 위젯으로 보여 준다.
// 위젯을 누르면 Notion 앱에서 Command Center 가 열린다. 보드 자체는 Notion 쪽에서 매일 아침 갱신된다.

const path = require('path')
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, nativeTheme, Notification, screen, shell, safeStorage, globalShortcut, powerMonitor, session } = require('electron')
const updater = require('./updater.js')
const notion = require('./notion.js')
const { Store } = require('./store.js')
const { pinToDesktop } = require('./win-desktop.js')

const ROOT = path.join(__dirname, '..')
const PRELOAD = path.join(ROOT, 'preload.js')
const IS_WIN = process.platform === 'win32'
const IS_MAC = process.platform === 'darwin'
const DEV = process.argv.includes('--dev')
const TEST_HOOK = process.env.NF_TEST_HOOK // 테스트용: E2E 스크립트 경로

if (TEST_HOOK && process.env.NF_DATA_DIR) app.setPath('userData', process.env.NF_DATA_DIR)

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}
if (IS_WIN) app.setAppUserModelId('com.junsang.neuralflow')

let store
let widget = null
let settingsWin = null
let tray = null
let widgetMode = 'pinned' // pinned(바탕화면 고정) | edit(이동)
let desktopPin = null // Windows Win+D 보호
let refreshing = false
let refreshTimer = null
let update = { checking: false, available: false }
const opened = [] // 테스트용: 연 주소 기록

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
const token = () => dec(store.get().settings.notion.tokenEnc)
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── 화면에 넘기는 상태 (토큰은 절대 넘기지 않는다) ──────────────────────────
function snapshot() {
  const d = store.get()
  const s = d.settings
  return {
    today: today(),
    version: app.getVersion(),
    platform: process.platform,
    widgetMode,
    refreshing,
    board: d.board,
    boardError: d.boardError || '',
    hasToken: !!s.notion.tokenEnc,
    update,
    winDesktop: desktopPin ? desktopPin.status() : null,
    ...(TEST_HOOK ? { test: { opened } } : {}),
    settings: {
      autoStart: s.autoStart,
      notion: { page: s.notion.page, defaultPage: notion.DEFAULT_PAGE, openIn: s.notion.openIn, refreshMinutes: s.notion.refreshMinutes },
      updates: s.updates,
      widget: s.widget,
      security: { contentProtection: s.security.contentProtection },
    },
  }
}

function broadcast() {
  for (const w of [widget, settingsWin]) if (w && !w.isDestroyed()) w.webContents.send('nf:changed')
}

// ── 보드 읽기 ────────────────────────────────────────────────────────────────
async function refresh() {
  if (refreshing) return { ok: false, message: '읽는 중이에요' }
  refreshing = true
  broadcast()
  try {
    const s = store.get().settings.notion
    const r = await notion.fetchBoard({ token: token(), page: s.page || notion.DEFAULT_PAGE, today: today() })
    store.update((d) => {
      if (r.ok) d.board = r.board
      d.boardError = r.ok ? '' : r.message
    })
    return r.ok ? { ok: true, days: r.board.days.length } : r
  } finally {
    refreshing = false
    broadcast()
  }
}

function scheduleRefresh() {
  clearInterval(refreshTimer)
  if (TEST_HOOK) return
  const min = Math.min(240, Math.max(5, Number(store.get().settings.notion.refreshMinutes) || 30))
  refreshTimer = setInterval(refresh, min * 60 * 1000)
}

// 누르면 Notion 앱으로 (설정이 '브라우저'거나 앱이 없으면 웹으로)
async function openNotion() {
  const s = store.get().settings.notion
  const urls = notion.openUrls(store.get().board, s.page || notion.DEFAULT_PAGE)
  const target = s.openIn === 'web' ? urls.web : urls.app
  if (TEST_HOOK) {
    opened.push(target)
    return { ok: true, url: target }
  }
  try {
    await shell.openExternal(target)
  } catch {
    await shell.openExternal(urls.web)
    return { ok: true, url: urls.web }
  }
  return { ok: true, url: target }
}

// ── 위젯 ─────────────────────────────────────────────────────────────────────
function widgetBounds(height = 520) {
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
    ...widgetBounds(prev && !prev.isDestroyed() ? prev.getBounds().height : 520),
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    alwaysOnTop: !pinned, // 이동 모드에서만 위로
    title: 'neural-flow',
    backgroundColor: '#00000000',
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, backgroundThrottling: false },
  }
  // Windows: 포커스를 받지 않는 창 → 눌러도 다른 창 위로 올라오지 않고 바탕화면에 머문다 (클릭은 받는다).
  // macOS·Linux: 'desktop' 타입은 클릭을 못 받으므로 쓰지 않고, 보통 창으로 다른 창 뒤에 둔다.
  if (pinned && IS_WIN) opts.focusable = false
  desktopPin?.stop()
  desktopPin = null
  widget = new BrowserWindow(opts)
  protect(widget)
  if (IS_MAC) widget.setVisibleOnAllWorkspaces(true)
  widget.loadFile(path.join(ROOT, 'renderer', 'widget', 'index.html'))
  widget.once('ready-to-show', () => {
    if (store.get().settings.widget.visible !== false) widget.showInactive()
    if (IS_WIN && pinned) desktopPin = pinToDesktop(widget) // Win+D 에도 남게
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

// ── 설정 창 ──────────────────────────────────────────────────────────────────
function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show()
    settingsWin.focus()
    return
  }
  settingsWin = new BrowserWindow({
    width: 560,
    height: 720,
    minWidth: 460,
    minHeight: 520,
    show: false,
    title: 'neural-flow 설정',
    icon: path.join(ROOT, 'assets', 'icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111113' : '#fcfcfd',
    autoHideMenuBar: true,
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true },
  })
  protect(settingsWin)
  settingsWin.loadFile(path.join(ROOT, 'renderer', 'app', 'index.html'))
  settingsWin.once('ready-to-show', () => settingsWin.show())
  settingsWin.on('closed', () => (settingsWin = null))
}

// ── 트레이 ───────────────────────────────────────────────────────────────────
function trayImage() {
  const img = nativeImage.createFromPath(path.join(ROOT, 'assets', IS_MAC ? 'trayTemplate.png' : 'tray.png'))
  if (IS_MAC) img.setTemplateImage(true)
  return img
}

function buildTray() {
  if (!tray) {
    tray = new Tray(trayImage())
    tray.setToolTip('neural-flow')
    tray.on('click', () => (IS_MAC ? tray.popUpContextMenu() : openNotion()))
  }
  const s = store.get().settings
  const shortcut = IS_MAC ? '⌘⌥N' : 'Ctrl+Alt+N'
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Notion 에서 열기', click: () => openNotion() },
      { label: '지금 새로고침', click: () => refresh() },
      { type: 'separator' },
      { label: s.widget.visible !== false ? '위젯 숨기기' : '위젯 보이기', click: toggleWidgetVisible },
      { label: widgetMode === 'edit' ? `위젯 고정하기 (${shortcut})` : `위젯 옮기기 (${shortcut})`, click: () => setWidgetMode(widgetMode === 'edit' ? 'pinned' : 'edit') },
      { label: '설정', click: openSettings },
      { type: 'separator' },
      ...(update.available ? [{ label: `업데이트 ${update.version} 설치`, click: () => installUpdate() }] : []),
      { label: '종료', role: 'quit' },
    ])
  )
}

// ── 보안 ─────────────────────────────────────────────────────────────────────
function protect(win) {
  // 화면 공유·캡처에 이 창이 찍히지 않게 (Windows·macOS)
  if (win && !win.isDestroyed()) win.setContentProtection(!!store.get().settings.security.contentProtection && !TEST_HOOK)
}
function hardenSession() {
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
}

// ── 업데이트 ─────────────────────────────────────────────────────────────────
let notifiedVersion = ''
async function checkUpdate({ manual = false } = {}) {
  if (update.checking || update.downloading != null || update.installing) return update
  update = { ...update, checking: true, error: '' }
  broadcast()
  try {
    const r = await updater.check(app.getVersion())
    update = { ...r, checking: false }
    if (manual && r.available && r.version === store.get().settings.updates.skipVersion) store.update((d) => (d.settings.updates.skipVersion = ''))
    const skip = store.get().settings.updates.skipVersion
    if (r.available && r.version !== notifiedVersion && (manual || r.version !== skip) && (!store.get().settings.updates.autoInstall || !app.isPackaged)) {
      notifiedVersion = r.version
      if (Notification.isSupported()) {
        const n = new Notification({ title: `⬆️ neural-flow ${r.version} 업데이트`, body: '눌러서 설정에서 업데이트하세요' })
        n.on('click', openSettings)
        n.show()
      }
    }
  } catch (e) {
    update = { ...update, checking: false, error: e.message }
  }
  broadcast()
  buildTray()
  if (!manual && updater.shouldAutoInstall(update, store.get().settings.updates, { packaged: app.isPackaged })) await installUpdate()
  return update
}
function startUpdateWatch() {
  if (TEST_HOOK) return
  const run = () => store.get().settings.updates.autoCheck && checkUpdate()
  setTimeout(run, 1500)
  setInterval(run, 6 * 3600 * 1000)
}
async function installUpdate() {
  if (update.downloading != null || update.installing) return { ok: false, message: '업데이트 중이에요' }
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
    update.installing = true
    broadcast()
    store.flush()
    updater.install(got.file, { appPath: IS_MAC ? path.resolve(app.getAppPath(), '..', '..', '..') : undefined })
    setTimeout(() => app.exit(0), 500)
    return { ok: true }
  } catch (e) {
    update = { ...update, downloading: null, installing: false, error: e.message }
    broadcast()
    return { ok: false, message: e.message }
  }
}

// ── IPC ──────────────────────────────────────────────────────────────────────
function registerIpc() {
  ipcMain.handle('nf:snapshot', () => snapshot())
  ipcMain.handle('nf:refresh', () => refresh())
  ipcMain.handle('nf:notion:open', () => openNotion())
  ipcMain.handle('nf:settings:open', () => openSettings())
  ipcMain.handle('nf:notion:token', async (_e, value) => {
    const t = String(value || '').trim()
    if (t && !/^(secret_|ntn_)[A-Za-z0-9]{20,}$/.test(t)) return { ok: false, message: "Notion 통합 토큰은 'ntn_' 또는 'secret_' 으로 시작해요" }
    store.update((d) => {
      d.settings.notion.tokenEnc = enc(t)
      if (!t) d.board = null
    })
    return t ? refresh() : { ok: true, cleared: true }
  })
  ipcMain.handle('nf:settings:save', (_e, patch = {}) => {
    store.update((d) => {
      const s = d.settings
      if (patch.notion) {
        if (patch.notion.page !== undefined) {
          const p = String(patch.notion.page || '').trim()
          s.notion.page = p && notion.pageIdOf(p) ? p : ''
        }
        if (['app', 'web'].includes(patch.notion.openIn)) s.notion.openIn = patch.notion.openIn
        if (patch.notion.refreshMinutes !== undefined) s.notion.refreshMinutes = Math.min(240, Math.max(5, Number(patch.notion.refreshMinutes) || 30))
      }
      if (patch.widget) {
        const w = patch.widget
        if (w.width !== undefined) s.widget.width = Math.min(520, Math.max(300, Number(w.width) || 360))
        if (w.opacity !== undefined) s.widget.opacity = Math.min(1, Math.max(0.3, Number(w.opacity) || 0.72))
        if (['auto', 'light', 'dark'].includes(w.theme)) s.widget.theme = w.theme
      }
      if (patch.updates) for (const k of ['autoCheck', 'autoInstall']) if (typeof patch.updates[k] === 'boolean') s.updates[k] = patch.updates[k]
      if (typeof patch.autoStart === 'boolean') s.autoStart = patch.autoStart
      if (typeof patch.security?.contentProtection === 'boolean') s.security.contentProtection = patch.security.contentProtection
    })
    const s = store.get().settings
    if (patch.widget?.width !== undefined) createWidget()
    if (patch.widget?.theme) nativeTheme.themeSource = s.widget.theme === 'auto' ? 'system' : s.widget.theme
    if (patch.autoStart !== undefined) applyAutoStart()
    if (patch.security) [widget, settingsWin].forEach(protect)
    if (patch.notion?.refreshMinutes !== undefined) scheduleRefresh()
    if (patch.notion?.page !== undefined) refresh()
    return snapshot().settings
  })
  ipcMain.handle('nf:widget:resize', (e, height) => {
    if (!widget || widget.isDestroyed() || e.sender !== widget.webContents) return
    const b = widgetBounds(Math.max(120, Math.round(Number(height) || 0)))
    widget.setBounds({ ...widget.getBounds(), height: b.height })
  })
  ipcMain.handle('nf:widget:mode', (_e, mode) => setWidgetMode(mode === 'edit' ? 'edit' : 'pinned'))
  ipcMain.handle('nf:update:check', () => checkUpdate({ manual: true }))
  ipcMain.handle('nf:update:install', () => installUpdate())
  ipcMain.handle('nf:update:skip', () => store.update((d) => (d.settings.updates.skipVersion = update.version || '')))
}

function applyAutoStart() {
  const on = !!store.get().settings.autoStart
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: on })
  else if (IS_WIN) app.setLoginItemSettings({ openAtLogin: on, path: process.execPath, args: [app.getAppPath()] })
}

// ── 시작 ─────────────────────────────────────────────────────────────────────
app.on('second-instance', () => openSettings())
app.on('window-all-closed', () => {}) // 창을 모두 닫아도 트레이에 상주
app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('web-contents-created', (_e, wc) => {
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/(www\.)?notion\.so\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  wc.on('will-navigate', (ev) => ev.preventDefault())
})

app.whenReady().then(async () => {
  if (IS_MAC) app.dock?.hide()
  // 저장 파일 암호화 (OS 키체인). 안 되는 환경에서는 평문 + 권한 600
  const cipher = safeStorage.isEncryptionAvailable()
    ? { encrypt: (str) => safeStorage.encryptString(str), decrypt: (buf) => safeStorage.decryptString(buf) }
    : null
  store = new Store(process.env.NF_DATA_DIR || app.getPath('userData'), { cipher }).load()
  hardenSession()
  const theme = store.get().settings.widget.theme
  nativeTheme.themeSource = theme === 'auto' ? 'system' : theme

  registerIpc()
  store.onChange(broadcast)
  createWidget()
  buildTray()
  applyAutoStart()
  startUpdateWatch()

  globalShortcut.register('CommandOrControl+Alt+N', () => setWidgetMode(widgetMode === 'edit' ? 'pinned' : 'edit'))
  globalShortcut.register('CommandOrControl+Alt+M', () => openSettings())

  // 켤 때 · 주기적으로 · 절전 복귀 · 화면 잠금 해제 때 다시 읽는다
  if (!TEST_HOOK) refresh()
  scheduleRefresh()
  powerMonitor.on('resume', () => !TEST_HOOK && refresh())
  powerMonitor.on('unlock-screen', () => !TEST_HOOK && refresh())
  screen.on('display-removed', () => createWidget())

  if (DEV || (!store.get().settings.notion.tokenEnc && !TEST_HOOK)) openSettings()
  if (TEST_HOOK) require(path.resolve(TEST_HOOK)).run({ app, store, getWidget: () => widget, openSettings, getSettings: () => settingsWin, setWidgetMode, refresh })
})
