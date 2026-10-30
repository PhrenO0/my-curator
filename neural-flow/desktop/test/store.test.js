// 저장소 단위 테스트 (node --test)
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { Store, MAGIC } = require('../main/store.js')

const cipher = { encrypt: (s) => Buffer.from(s).reverse(), decrypt: (b) => Buffer.from(b).reverse().toString() }

test('0.8 데이터에서 넘어오면 위젯 위치·업데이트 설정만 남기고 나머지는 버림', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-store-'))
  const old = {
    version: 1,
    settings: { autoStart: false, geminiKeyEnc: 'x', google: { clientId: 'c' }, widget: { x: 10, y: 20, width: 400, opacity: 0.5, showNews: true }, updates: { autoInstall: false } },
    events: [{ id: 1 }],
    memo: { text: '비밀 메모' },
    roadmaps: [{}],
    account: { email: 'a@b' },
  }
  fs.writeFileSync(path.join(dir, 'neural-flow.json'), MAGIC + cipher.encrypt(JSON.stringify(old)).toString('base64'))
  const s = new Store(dir, { cipher }).load()
  const d = s.get()
  assert.equal(d.version, 2)
  assert.deepEqual(Object.keys(d).sort(), ['board', 'boardError', 'settings', 'version'])
  assert.deepEqual(d.settings.widget, { visible: true, x: 10, y: 20, width: 400, opacity: 0.5, theme: 'auto' })
  assert.equal(d.settings.updates.autoInstall, false)
  assert.equal(d.settings.autoStart, false)
  assert.equal(d.settings.google, undefined)
  // 디스크도 바로 정리돼 있다 (암호문, 메모 없음)
  const raw = fs.readFileSync(path.join(dir, 'neural-flow.json'), 'utf8')
  assert.ok(raw.startsWith(MAGIC))
  assert.ok(!cipher.decrypt(Buffer.from(raw.slice(MAGIC.length), 'base64')).includes('비밀 메모'))
})

test('보드·토큰 저장 → 다시 열기 · 복호화 못 하는 파일이면 새로 시작', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-store-'))
  const s = new Store(dir, { cipher }).load()
  s.update((d) => {
    d.settings.notion.tokenEnc = 'enc:abc'
    d.board = { days: [{ date: '2026-10-30', items: [] }] }
  })
  s.flush()
  const again = new Store(dir, { cipher }).load().get()
  assert.equal(again.settings.notion.tokenEnc, 'enc:abc')
  assert.equal(again.board.days[0].date, '2026-10-30')
  const broken = new Store(dir, { cipher: null }).load().get()
  assert.equal(broken.board, null)
})
