// 로컬 저장소 — userData/neural-flow.json 하나 (OS 키체인으로 암호화).
// 담는 것: 설정(Notion 토큰은 따로 암호화) + 마지막으로 읽은 7일 보드.
// 0.8 이전 파일을 열면 위젯 위치·업데이트 설정만 이어받고 나머지(일정·메모·로드맵…)는 버린다.

const fs = require('fs')
const path = require('path')

const DEFAULT_SETTINGS = {
  autoStart: true,
  notion: {
    tokenEnc: '', // Notion 내부 통합 토큰 (safeStorage 로 암호화)
    page: '', // 비어 있으면 기본 Command Center
    openIn: 'app', // app = Notion 데스크톱 앱 (notion://), web = 브라우저
    refreshMinutes: 30,
  },
  security: { encryptData: true, contentProtection: true },
  updates: { autoCheck: true, autoInstall: true, skipVersion: '' },
  widget: { visible: true, x: null, y: null, width: 360, opacity: 0.72, theme: 'auto' },
}

function mergeSettings(saved) {
  const base = structuredClone(DEFAULT_SETTINGS)
  if (!saved) return base
  const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj && obj[k] !== undefined).map((k) => [k, obj[k]]))
  return {
    autoStart: saved.autoStart ?? base.autoStart,
    notion: { ...base.notion, ...pick(saved.notion, Object.keys(base.notion)) },
    security: { ...base.security, ...pick(saved.security, Object.keys(base.security)) },
    updates: { ...base.updates, ...pick(saved.updates, Object.keys(base.updates)) },
    widget: { ...base.widget, ...pick(saved.widget, Object.keys(base.widget)) },
  }
}

function emptyData() {
  return { version: 2, settings: structuredClone(DEFAULT_SETTINGS), board: null, boardError: '' }
}

// 디스크 암호화: cipher = { encrypt(str) → Buffer, decrypt(Buffer) → str } (main 에서 safeStorage 로 넘긴다)
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
    let saved = null
    try {
      saved = this._read()
    } catch {
      saved = null // 복호화할 수 없는 파일이면 새로 시작
    }
    const fresh = emptyData()
    this.data = saved
      ? { ...fresh, settings: mergeSettings(saved.settings), board: saved.version === 2 ? saved.board || null : null, boardError: '' }
      : fresh
    if (!saved || saved.version !== 2) this.flush() // 첫 실행 · 옛 데이터 정리
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

module.exports = { Store, DEFAULT_SETTINGS, MAGIC, mergeSettings }
