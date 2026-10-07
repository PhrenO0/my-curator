// 보안 · 저장소 암호화 · 업데이트 단위 테스트 (node --test)
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const crypto = require('crypto')
const { hashPin, verifyPin } = require('../main/security.js')

test('PIN: scrypt 해시 · 같은 PIN 도 매번 다른 해시 · 틀린 PIN 거부', () => {
  const h1 = hashPin('1234')
  const h2 = hashPin('1234')
  assert.notEqual(h1, h2)
  assert.ok(!h1.includes('1234'))
  assert.ok(verifyPin('1234', h1))
  assert.ok(!verifyPin('1235', h1))
  assert.ok(!verifyPin('1234', ''))
  assert.ok(!verifyPin('1234', 'plain:1234'))
})

test('저장소 암호화: 디스크엔 암호문, 다시 읽으면 원래 데이터, 옛 평문 파일은 자동 전환', () => {
  // 가짜 cipher (실제 앱은 OS 키체인 safeStorage)
  const key = crypto.randomBytes(32)
  const cipher = {
    encrypt: (s) => {
      const iv = crypto.randomBytes(12)
      const c = crypto.createCipheriv('aes-256-gcm', key, iv)
      const body = Buffer.concat([c.update(s, 'utf8'), c.final()])
      return Buffer.concat([iv, c.getAuthTag(), body])
    },
    decrypt: (b) => {
      const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12))
      d.setAuthTag(b.subarray(12, 28))
      return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8')
    },
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-enc-'))
  process.env.NF_STATE_JSON = path.join(dir, 'none.json')
  delete require.cache[require.resolve('../main/store.js')]
  const { Store, MAGIC } = require('../main/store.js')

  // 옛 평문 파일
  fs.writeFileSync(path.join(dir, 'neural-flow.json'), JSON.stringify({ events: [{ id: 'a', title: '비밀 일정', date: '2026-10-10' }] }))
  const s = new Store(dir, { cipher }).load()
  assert.equal(s.get().events[0].title, '비밀 일정')
  s.flush()
  const raw = fs.readFileSync(path.join(dir, 'neural-flow.json'), 'utf-8')
  assert.ok(raw.startsWith(MAGIC), '암호화돼서 저장')
  assert.ok(!raw.includes('비밀 일정'), '디스크에 평문 없음')
  assert.ok(s.encrypted)
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'neural-flow.json')).mode & 0o777, 0o600)

  const again = new Store(dir, { cipher }).load()
  assert.equal(again.get().events[0].title, '비밀 일정')
  assert.throws(() => new Store(dir).load(), /복호화 수단/)

  // 암호화를 끄면 평문으로 돌아간다
  again.get().settings.security.encryptData = false
  again.flush()
  assert.ok(!new Store(dir).encrypted)
  delete process.env.NF_STATE_JSON
})

// ── 업데이트 ──
const { newer, pickAsset } = require('../main/updater.js')

test('버전 비교 · OS별 설치 파일 고르기', () => {
  assert.ok(newer('0.2.1', '0.2.0'))
  assert.ok(newer('desktop-v0.10.0', '0.9.9'))
  assert.ok(!newer('0.2.0', '0.2.0'))
  assert.ok(!newer('0.1.9', '0.2.0'))
  const assets = [{ name: 'neural-flow-0.2.1-win-x64.exe' }, { name: 'neural-flow-0.2.1-mac-arm64.dmg' }, { name: 'neural-flow-0.2.1-mac-x64.dmg' }]
  assert.equal(pickAsset(assets, 'win32', 'x64').name, 'neural-flow-0.2.1-win-x64.exe')
  assert.equal(pickAsset(assets, 'darwin', 'arm64').name, 'neural-flow-0.2.1-mac-arm64.dmg')
  assert.equal(pickAsset(assets, 'darwin', 'x64').name, 'neural-flow-0.2.1-mac-x64.dmg')
  assert.equal(pickAsset(assets, 'linux', 'x64'), null)
})

test('업데이트 확인 → 다운로드 → SHA-256 검증 (틀리면 거부)', async () => {
  const payload = Buffer.from('fake installer bytes')
  const sha = crypto.createHash('sha256').update(payload).digest('hex')
  let digest = `sha256:${sha}`
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/repos/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(
        JSON.stringify([
          { tag_name: 'other-v9', draft: false, assets: [] },
          {
            tag_name: 'desktop-v0.3.0',
            draft: false,
            prerelease: false,
            html_url: 'https://example.com/r',
            body: '노트',
            assets: [{ name: 'neural-flow-0.3.0-win-x64.exe', browser_download_url: `http://127.0.0.1:${server.address().port}/dl`, size: payload.length, digest }],
          },
        ])
      )
    }
    res.writeHead(200)
    res.end(payload)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  process.env.NF_UPDATE_API = `http://127.0.0.1:${server.address().port}`
  delete require.cache[require.resolve('../main/updater.js')]
  const up = require('../main/updater.js')
  try {
    const r = await up.check('0.2.1', { platform: 'win32', arch: 'x64' })
    assert.equal(r.available, true)
    assert.equal(r.version, '0.3.0')
    assert.equal(r.asset.sha256, sha)
    assert.equal((await up.check('0.3.0', { platform: 'win32', arch: 'x64' })).available, false)

    let last = 0
    const got = await up.download(r.asset, (p) => (last = p))
    assert.ok(got.verified)
    assert.equal(fs.readFileSync(got.file, 'utf8'), 'fake installer bytes')
    assert.equal(last, 1)

    await assert.rejects(up.download({ ...r.asset, sha256: 'deadbeef' }), /SHA-256/)
  } finally {
    server.close()
    delete process.env.NF_UPDATE_API
  }
})
