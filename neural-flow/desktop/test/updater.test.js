// 자동 업데이트 단위 테스트 (node --test)
const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const path = require('path')

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

    await assert.rejects(up.download({ ...r.asset, sha256: '0'.repeat(64) }), /SHA-256/)
    await assert.rejects(up.download({ ...r.asset, sha256: '' }), /SHA-256/)
    fs.rmSync(path.dirname(got.file), { recursive: true, force: true })
  } finally {
    server.close()
    delete process.env.NF_UPDATE_API
  }
})
