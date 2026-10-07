// 자동 업데이트 — GitHub Releases 의 최신 'desktop-v*' 를 확인해 알리고, 누르면 받아서 설치한다.
//
// 코드 서명이 없는 개인용 빌드라 OS 기본 자동 업데이트(Squirrel 등)는 못 쓴다. 대신:
//   1) GitHub API 로 최신 릴리스 확인 → 버전 비교
//   2) 이 OS·칩에 맞는 설치 파일을 임시 폴더로 받는다
//   3) GitHub 이 기록한 SHA-256 과 비교해 변조·손상 검사 (다르면 설치하지 않는다)
//   4) Windows: 설치 파일을 조용히 실행(/S --force-run) 후 앱 종료 → 설치가 끝나면 새 버전으로 다시 켜짐
//      macOS : dmg 를 붙여 /Applications 에 복사 → 격리 표시 제거 → 다시 실행

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { spawn } = require('child_process')

const REPO = process.env.NF_UPDATE_REPO || 'PhrenO0/my-curator'
const API = process.env.NF_UPDATE_API || 'https://api.github.com'

// 'desktop-v0.2.1' / '0.2.1' → [0,2,1]
const parse = (v) => String(v).replace(/^desktop-v|^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
function newer(a, b) {
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0)
  return false
}

function pickAsset(assets, platform = process.platform, arch = process.arch) {
  if (platform === 'win32') return assets.find((a) => /win.*x64.*\.exe$/i.test(a.name))
  if (platform === 'darwin') return assets.find((a) => a.name.endsWith(`-${arch === 'arm64' ? 'arm64' : 'x64'}.dmg`))
  return null
}

async function check(current, { platform, arch } = {}) {
  const res = await fetch(`${API}/repos/${REPO}/releases?per_page=20`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'neural-flow-updater' },
  })
  if (!res.ok) throw new Error(`업데이트 확인 실패 (HTTP ${res.status})`)
  const rel = (await res.json()).find((r) => r.tag_name?.startsWith('desktop-v') && !r.draft && !r.prerelease)
  if (!rel) return { available: false, current }
  const version = rel.tag_name.replace('desktop-v', '')
  const asset = pickAsset(rel.assets || [], platform, arch)
  return {
    available: newer(version, current) && !!asset,
    current,
    version,
    notes: (rel.body || '').slice(0, 600),
    url: rel.html_url,
    asset: asset ? { name: asset.name, url: asset.browser_download_url, size: asset.size, sha256: (asset.digest || '').replace(/^sha256:/, '') } : null,
  }
}

async function download(asset, onProgress = () => {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-update-'))
  const file = path.join(dir, path.basename(asset.name))
  const res = await fetch(asset.url, { headers: { 'User-Agent': 'neural-flow-updater' } })
  if (!res.ok || !res.body) throw new Error(`다운로드 실패 (HTTP ${res.status})`)
  const hash = crypto.createHash('sha256')
  const out = fs.createWriteStream(file)
  let got = 0
  for await (const chunk of res.body) {
    hash.update(chunk)
    out.write(chunk)
    got += chunk.length
    onProgress(asset.size ? got / asset.size : 0)
  }
  await new Promise((r, j) => out.end((e) => (e ? j(e) : r())))
  const sha = hash.digest('hex')
  if (asset.sha256 && asset.sha256 !== sha) {
    fs.rmSync(dir, { recursive: true, force: true })
    throw new Error('받은 파일의 SHA-256 이 릴리스 기록과 달라요 — 설치하지 않았어요')
  }
  return { file, sha256: sha, verified: !!asset.sha256 }
}

// 설치 단계는 앱이 꺼진 뒤 진행돼야 하므로 분리된 프로세스로 띄운다
function install(file, { platform = process.platform, appPath } = {}) {
  if (platform === 'win32') {
    spawn(file, ['/S', '--force-run', '--updated'], { detached: true, stdio: 'ignore' }).unref()
    return
  }
  if (platform === 'darwin') {
    const target = appPath || '/Applications/neural-flow.app'
    const script = `
      sleep 1
      MNT=$(mktemp -d)
      hdiutil attach "${file}" -nobrowse -quiet -mountpoint "$MNT" || exit 1
      rm -rf "${target}.old" && mv "${target}" "${target}.old" 2>/dev/null
      cp -R "$MNT/neural-flow.app" "${target}" && rm -rf "${target}.old"
      hdiutil detach "$MNT" -quiet
      xattr -dr com.apple.quarantine "${target}" 2>/dev/null
      open "${target}"`
    spawn('/bin/bash', ['-c', script], { detached: true, stdio: 'ignore' }).unref()
    return
  }
  throw new Error('이 OS 는 자동 설치를 지원하지 않아요 — 릴리스 페이지에서 받아 주세요')
}

module.exports = { check, download, install, newer, pickAsset }
