// Windows 전용: Win+D(바탕화면 보기)에도 위젯이 사라지지 않게 한다.
//
// 두 겹으로 막는다.
//  1) 소유자(owner)를 바탕화면 창(Progman)으로 지정 — 바탕화면에 '딸린' 창이 되어
//     바탕화면 보기 때 다른 앱 창과 함께 내려가지 않는다 (데스크탑 가젯류가 쓰는 방식).
//  2) 감시(watchdog) — 1)이 OS 버전에 따라 안 먹을 때를 대비해, 전경 창이 바탕화면
//     (Progman/WorkerW)으로 바뀌면 위젯을 활성화 없이 다시 보여주고 맨 앞으로 올린다.
//
// koffi(순수 FFI, 빌드 도구 불필요)로 user32.dll 을 부른다. 실패하면 조용히 꺼진다.

const SW_SHOWNOACTIVATE = 4
const SWP_NOSIZE = 0x0001
const SWP_NOMOVE = 0x0002
const SWP_NOACTIVATE = 0x0010
const SWP_SHOWWINDOW = 0x0040
const HWND_TOP = 0
const GWLP_HWNDPARENT = -8
const GW_OWNER = 4
const DESKTOP_CLASSES = new Set(['Progman', 'WorkerW'])

let api = null

function load() {
  if (api !== null) return api
  api = false
  if (process.platform !== 'win32') return api
  try {
    const koffi = require('koffi')
    const user32 = koffi.load('user32.dll')
    const is64 = process.arch === 'x64' || process.arch === 'arm64'
    api = {
      FindWindowW: user32.func('intptr_t __stdcall FindWindowW(const char16_t *cls, const char16_t *name)'),
      GetForegroundWindow: user32.func('intptr_t __stdcall GetForegroundWindow()'),
      GetClassNameW: user32.func('int __stdcall GetClassNameW(intptr_t hwnd, _Out_ char16_t *buf, int max)'),
      SetOwner: is64
        ? user32.func('intptr_t __stdcall SetWindowLongPtrW(intptr_t hwnd, int index, intptr_t value)')
        : user32.func('long __stdcall SetWindowLongW(intptr_t hwnd, int index, long value)'),
      GetWindow: user32.func('intptr_t __stdcall GetWindow(intptr_t hwnd, unsigned int cmd)'),
      ShowWindow: user32.func('bool __stdcall ShowWindow(intptr_t hwnd, int cmd)'),
      IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(intptr_t hwnd)'),
      IsIconic: user32.func('bool __stdcall IsIconic(intptr_t hwnd)'),
      SetWindowPos: user32.func(
        'bool __stdcall SetWindowPos(intptr_t hwnd, intptr_t after, int x, int y, int cx, int cy, unsigned int flags)'
      ),
    }
  } catch (e) {
    console.warn('[win-desktop] koffi 로드 실패 — Win+D 보호 꺼짐:', e.message)
  }
  return api
}

function hwndOf(win) {
  const buf = win.getNativeWindowHandle()
  return buf.length >= 8 ? Number(buf.readBigUInt64LE(0)) : buf.readUInt32LE(0)
}

function className(a, hwnd) {
  const buf = Buffer.alloc(512)
  const n = a.GetClassNameW(hwnd, buf, 256)
  return n > 0 ? buf.toString('utf16le', 0, n * 2) : ''
}

// 위젯 창에 Win+D 보호를 건다. 반환값의 stop() 으로 해제.
function pinToDesktop(win, { intervalMs = 400 } = {}) {
  const a = load()
  if (!a || !win || win.isDestroyed()) return { active: false, stop() {}, status: () => ({ active: false }) }

  const hwnd = hwndOf(win)
  const progman = a.FindWindowW('Progman', null)
  if (progman) a.SetOwner(hwnd, GWLP_HWNDPARENT, progman)

  let revived = 0
  const reveal = () => {
    if (win.isDestroyed()) return
    if (a.IsIconic(hwnd) || !a.IsWindowVisible(hwnd)) a.ShowWindow(hwnd, SW_SHOWNOACTIVATE)
    a.SetWindowPos(hwnd, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW)
    revived++
  }

  // Electron 쪽에서 최소화가 일어나도 바로 되돌린다
  const onMinimize = () => setTimeout(reveal, 0)
  win.on('minimize', onMinimize)

  let lastWasDesktop = false
  const timer = setInterval(() => {
    if (win.isDestroyed() || !win.isVisible()) return
    const fg = a.GetForegroundWindow()
    const onDesktop = fg && DESKTOP_CLASSES.has(className(a, fg))
    // 바탕화면이 막 앞으로 나온 순간(=Win+D, 바탕화면 클릭) + 위젯이 가려졌거나 최소화됐을 때
    if (onDesktop && (!lastWasDesktop || a.IsIconic(hwnd))) reveal()
    lastWasDesktop = onDesktop
  }, intervalMs)

  return {
    active: true,
    stop() {
      clearInterval(timer)
      if (!win.isDestroyed()) win.removeListener('minimize', onMinimize)
    },
    status: () => ({
      active: true,
      ownerIsDesktop: !!progman && a.GetWindow(hwnd, GW_OWNER) === progman,
      visible: a.IsWindowVisible(hwnd),
      iconic: a.IsIconic(hwnd),
      revived,
    }),
  }
}

module.exports = { pinToDesktop }
