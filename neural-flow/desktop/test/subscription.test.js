const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { detectCodex, callCodex } = require('../main/codex.js')
const { ready } = require('../main/llm.js')
const { shouldAutoInstall } = require('../main/updater.js')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-subscription-test-'))
const fake = path.join(dir, 'fake.cjs')
fs.writeFileSync(fake, `
const fs=require('fs');const a=process.argv.slice(2)
if(a.includes('--version')){console.log('codex-cli 1.0.0');process.exit(0)}
if(a.includes('login')){console.error('Logged in using ChatGPT');process.exit(0)}
let input='';process.stdin.on('data',d=>input+=d);process.stdin.on('end',()=>{
 if(!a.includes('read-only')||!a.includes('--ephemeral')||!a.includes('features.shell_tool=false')) process.exit(3)
 const output=a[a.indexOf('--output-last-message')+1]
 fs.writeFileSync(output,JSON.stringify({ok:true,provider:'codex',promptReceived:input.includes('일정'),apiKeyPresent:!!process.env.OPENAI_API_KEY}))
})
`)
const cmd = `"${process.execPath}" "${fake}"`
test.after(() => fs.rmSync(dir, { recursive: true, force: true }))
test('ChatGPT 구독 로그인 상태를 확인하고 읽기 전용 일회성 Codex 실행', async () => {
  const status = await detectCodex(cmd)
  assert.equal(status.subscription, true)
  assert.equal(status.version, 'codex-cli 1.0.0')
  const old = process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY = 'fake-api-key-not-for-billing'
  try {
    const out = await callCodex({ codexCmd: cmd }, '일정 해석 연결 확인', { timeoutMs: 10000 })
    assert.equal(out.ok, true)
    assert.equal(out.promptReceived, true)
    assert.equal(out.apiKeyPresent, false)
    assert.equal(ready({ provider: 'codex' }), true)
  } finally {
    if (old === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = old
  }
})
test('API 인증은 ChatGPT 구독 로그인으로 간주하지 않는다', async () => {
  const api = path.join(dir, 'api.cjs')
  fs.writeFileSync(api, `console.log(process.argv.includes('login') ? 'Logged in using an API key' : 'codex-cli 1.0.0')`)
  const apiCmd=`"${process.execPath}" "${api}"`
  assert.equal((await detectCodex(apiCmd)).subscription, false)
  await assert.rejects(callCodex({codexCmd:apiCmd},'test'), /ChatGPT 계정/)
})
test('자동 업데이트는 설치본·새 버전에만 적용하고 입력 중이면 기다린다', () => {
  const update={available:true,version:'0.5.0',asset:{name:'installer.exe'}}
  assert.ok(shouldAutoInstall(update,{autoInstall:true},{packaged:true}))
  assert.ok(!shouldAutoInstall(update,{autoInstall:true},{packaged:true,dirty:true}))
  assert.ok(!shouldAutoInstall(update,{autoInstall:true},{packaged:true,installing:true}))
  assert.ok(!shouldAutoInstall(update,{autoInstall:true},{packaged:false}))
  assert.ok(!shouldAutoInstall(update,{autoInstall:false},{packaged:true}))
  assert.ok(!shouldAutoInstall(update,{autoInstall:true,skipVersion:'0.5.0'},{packaged:true}))
})

test('응답이 멈춘 Codex 호출은 시간 초과 후 종료한다', async () => {
  const hanging = path.join(dir, 'hanging.cjs')
  fs.writeFileSync(hanging, `
if(process.argv.includes('--version')) console.log('codex-cli 1.0.0')
else if(process.argv.includes('login')) console.log('Logged in using ChatGPT')
else setInterval(()=>{},1000)
`)
  await assert.rejects(callCodex({codexCmd:`"${process.execPath}" "${hanging}"`},'test',{timeoutMs:100}), /응답 시간 초과/)
})
