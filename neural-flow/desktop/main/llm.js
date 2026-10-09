// LLM 엔진 — 하나의 함수(callJson)로 Gemini 또는 노트북에 설치된 Claude Code 를 부른다.
//
//   provider 'gemini' : Gemini REST (API 키)
//   provider 'claude' : 로컬 `claude -p` (Claude Code 헤드리스 모드, 사용자의 Claude 로그인/구독을 그대로 씀)
//   provider 'none'   : 호출하지 않음 → 각 기능이 규칙 기반 폴백을 쓴다
//
// 어느 엔진이든 'JSON 하나'를 돌려받는 것으로 통일한다.

const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const GEMINI_BASE = process.env.NF_GEMINI_BASE || 'https://generativelanguage.googleapis.com' // 테스트용 교체 가능
const GEMINI_URL = (model) => `${GEMINI_BASE}/v1beta/models/${encodeURIComponent(model)}:generateContent`

function parseJson(raw) {
  let s = String(raw || '').trim()
  if (s.startsWith('```')) s = s.replace(/^```(?:json)?/, '').replace(/```$/, '').trim()
  try {
    return JSON.parse(s)
  } catch {
    const a = s.indexOf('{')
    const b = s.lastIndexOf('}')
    if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1))
    throw new Error('JSON 파싱 실패')
  }
}

// provider 를 생략하면(옛 설정·테스트) 키가 있으면 gemini 로 본다
const providerOf = (llm) => llm?.provider || (llm?.key ? 'gemini' : 'none')
const ready = (llm) => {
  const p = providerOf(llm)
  return p === 'codex' || p === 'claude' || (p === 'gemini' && !!llm.key)
}

async function callGemini({ key, model }, prompt, { temperature, timeoutMs }) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(GEMINI_URL(model || 'gemini-2.5-flash'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature, responseMimeType: 'application/json' },
      }),
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const json = await res.json()
    return parseJson(json?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '')
  } finally {
    clearTimeout(t)
  }
}

// 빈 작업 폴더에서 실행 → repo 의 hooks/CLAUDE.md 등을 끌어오지 않는다
let workDir = null
function emptyDir() {
  if (!workDir) {
    workDir = path.join(os.tmpdir(), 'neural-flow-claude')
    fs.mkdirSync(workDir, { recursive: true })
  }
  return workDir
}

function callClaude({ claudeCmd, claudeModel }, prompt, { timeoutMs, web }) {
  return new Promise((resolve, reject) => {
    // 모델 이름은 사용자 입력이라 셸에 넘기기 전에 모양을 검사한다
    const model = /^[\w.:-]+$/.test(claudeModel || '') ? ` --model ${claudeModel}` : ''
    // web: 마감·행사 정보처럼 모르는 사실은 직접 검색하게 (검색·읽기 도구만 허용)
    const tools = web ? ' --allowedTools WebSearch WebFetch' : ' --tools ""'
    const command = `${claudeCmd || 'claude'} -p --output-format json --permission-mode dontAsk${model}${tools}`
    const env = { ...process.env }
    delete env.ANTHROPIC_API_KEY
    delete env.ANTHROPIC_BASE_URL
    delete env.ANTHROPIC_AUTH_TOKEN
    const child = spawn(command, { cwd: emptyDir(), env, shell: true, windowsHide: true, detached: process.platform !== 'win32' })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill())
      else { try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill() } }
      reject(new Error('Claude Code 응답 시간 초과'))
    }, timeoutMs)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`Claude Code 실행 실패: ${e.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      try {
        const env = JSON.parse(out)
        if (env.is_error || code !== 0) throw new Error(String(env.result || err || `exit ${code}`).slice(0, 200))
        resolve(parseJson(env.result))
      } catch (e) {
        reject(new Error(`Claude Code: ${e.message || err.slice(0, 200)}`))
      }
    })
    child.stdin.end(
      web
        ? `${prompt}\n\n[조사 규칙] 마감일·행사 장소·신청 조건처럼 일정에 없는 사실은 추측하지 말고 WebSearch/WebFetch 로 직접 확인하라. 확인한 사실에는 출처 URL 을 붙이고, 못 찾으면 '확인 못 함'이라고 써라.\n[출력 규칙] 설명 없이 위에서 요구한 JSON 객체 하나만 출력하라.`
        : `${prompt}\n\n[출력 규칙] 도구를 쓰지 말고, 설명 없이 위에서 요구한 JSON 객체 하나만 출력하라.`
    )
  })
}

async function callJson(llm, prompt, { temperature = 0.4, timeoutMs, web = false } = {}) {
  const p = providerOf(llm)
  if (p === 'codex') return require('./codex.js').callCodex(llm, prompt, { timeoutMs: timeoutMs || 90000 })
  if (p === 'gemini') return callGemini(llm, prompt, { temperature, timeoutMs: timeoutMs || 45000 })
  if (p === 'claude') return callClaude(llm, prompt, { timeoutMs: timeoutMs || (web ? 240000 : 120000), web })
  throw new Error('LLM 엔진이 꺼져 있어요')
}

// 노트북에 Claude Code 가 깔려 있고 로그인돼 있는지
function detectClaude(cmd = 'claude') {
  return new Promise((resolve) => {
    const child = spawn(`${cmd} --version`, { shell: true, windowsHide: true, detached: process.platform !== 'win32' })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.on('error', () => resolve(null))
    child.on('close', (code) => resolve(code === 0 ? out.trim().split('\n')[0] : null))
    setTimeout(() => {
      child.kill()
      resolve(null)
    }, 8000)
  })
}

module.exports = { callJson, parseJson, providerOf, ready, detectClaude }
