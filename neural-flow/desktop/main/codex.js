// Reuse the local Codex CLI's ChatGPT login; do not copy credentials into the app.
const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const quote = (v) => process.platform === 'win32' ? `"${v.replace(/"/g, '""')}"` : `'${v.replace(/'/g, "'\\''")}'`
function stopTree(child) {
  if (!child.pid) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill())
  } else { try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill() } }
}
function run(command, { cwd, input = '', timeoutMs = 90000 } = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env }
    delete env.OPENAI_API_KEY // Use the ChatGPT login, not API billing.
    const child = spawn(command, { cwd, env, shell: true, windowsHide: true, detached: process.platform !== 'win32' })
    let out = '', err = '', settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      error ? reject(error) : resolve(value)
    }
    const timer = setTimeout(() => {
      stopTree(child)
      finish(new Error('Codex 응답 시간 초과'))
    }, timeoutMs)
    child.stdout.on('data', (d) => out += d)
    child.stderr.on('data', (d) => err += d)
    child.on('error', (e) => finish(new Error(`Codex 실행 실패: ${e.message}`)))
    child.on('close', (code) => finish(null, { out, err, code }))
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}
async function detectCodex(cmd = 'codex') {
  try {
    const version = await run(`${cmd} --version`, { timeoutMs: 8000 })
    if (version.code !== 0) return null
    const status = await run(`${cmd} login status`, { timeoutMs: 8000 })
    return { version: version.out.trim().split('\n')[0], subscription: status.code === 0 && /logged in using chatgpt/i.test(status.out + status.err) }
  } catch { return null }
}
async function callCodex({ codexCmd = 'codex', codexModel }, prompt, { timeoutMs = 90000 } = {}) {
  const status = await detectCodex(codexCmd)
  if (!status?.subscription) throw new Error('Codex CLI에서 codex login으로 ChatGPT 계정에 로그인해 주세요')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neural-flow-codex-'))
  const output = path.join(dir, 'answer.json')
  try {
    const model = /^[\w.:-]+$/.test(codexModel || '') ? ` --model ${codexModel}` : ''
    const command = `${codexCmd} exec --skip-git-repo-check --sandbox read-only --ephemeral -c model_provider="openai" -c features.shell_tool=false -c features.multi_agent=false -c web_search=\"disabled\"${model} --output-last-message ${quote(output)} -`
    const r = await run(command, { cwd: dir, timeoutMs, input: `${prompt}\n도구·파일·검색을 사용하지 말고 제공한 정보만으로 요청한 JSON 객체 하나를 출력하세요.` })
    if (r.code !== 0) throw new Error(`Codex 실행 오류: ${r.err.slice(-300) || r.code}`)
    const text = fs.readFileSync(output, 'utf8').trim()
    return require('./llm.js').parseJson(text)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}
module.exports = { detectCodex, callCodex }
