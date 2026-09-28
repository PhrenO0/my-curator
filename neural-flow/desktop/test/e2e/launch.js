// E2E 실행기: 임시 데이터 폴더로 Electron 앱을 띄우고 hook.js 결과(종료 코드)를 그대로 돌려준다.
//   npm run test:e2e                 (Linux CI 에서는 xvfb-run 으로 감싼다)
//   NF_SHOT_DIR=./shots npm run test:e2e   → 화면 캡처도 저장
const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const electron = require('electron') // Node 에서 require 하면 실행 파일 경로

const root = path.join(__dirname, '..', '..')
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-e2e-'))
const port = String(47000 + Math.floor(Math.random() * 900))
if (process.env.NF_SHOT_DIR) fs.mkdirSync(process.env.NF_SHOT_DIR, { recursive: true })

const args = ['.']
if (process.platform === 'linux') args.push('--no-sandbox', '--disable-gpu')

const child = spawn(electron, args, {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    NF_TEST_HOOK: path.join(__dirname, 'hook.js'),
    NF_DATA_DIR: dataDir,
    NF_E2E_PORT: port,
    NF_GEMINI_BASE: `http://127.0.0.1:${port}`,
    GOOGLE_API_KEY: '', // 개발자 PC 의 실제 키가 섞이지 않게
  },
})

// Chromium 의 무해한 로그(dbus 등)는 숨기고 결과만 보여준다
const show = (buf) => {
  for (const line of String(buf).split('\n')) {
    if (line.trim() && !/^\[\d+:\d+\/|dbus|Gtk-|atom_cache/.test(line)) console.log(line)
  }
}
child.stdout.on('data', show)
child.stderr.on('data', show)

const timer = setTimeout(() => {
  console.error('E2E 시간 초과 (120초)')
  child.kill('SIGKILL')
}, 120000)

child.on('exit', (code) => {
  clearTimeout(timer)
  fs.rmSync(dataDir, { recursive: true, force: true })
  process.exit(code ?? 1)
})
