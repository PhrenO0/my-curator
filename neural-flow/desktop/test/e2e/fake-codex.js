const fs = require('fs')
const args = process.argv.slice(2)
if (args.includes('--version')) { console.log('codex-cli 1.0.0 (fake)'); process.exit(0) }
if (args.includes('login')) { console.log('Logged in using ChatGPT'); process.exit(0) }
let text = ''
process.stdin.on('data', (c) => text += c)
process.stdin.on('end', () => {
  const from = text.match(/오늘:?\s*(\d{4}-\d{2}-\d{2})/)?.[1] || '2026-10-09'
  const date = new Date(from + 'T12:00:00'); date.setDate(date.getDate() + 1)
  const plan = new Date(from + 'T12:00:00'); plan.setDate(plan.getDate() + 3)
  const out = text.includes('공부 일정 코치')
    ? { summary: 'CODEX: 교통 계산 먼저', items: [{ title: '[교통정책론] GC 계산 3회', date: plan.toISOString().slice(0, 10), start: '06:30', minutes: 60, note: '시험전략 우선순위 1' }], questions: ['지속 중간고사 날짜는?'] }
    : text.includes('일정 코치')
    ? { answer: text.includes('### 교통정책론') ? 'CODEX: 교통정책론 자료를 봤어요.' : 'CODEX: 약속 사이 이동 시간을 확인하세요.', observations: ['확인된 일정만 검토했어요.'], questions: [] }
    : { items: [{ kind: 'event', title: 'CODEX: 커피챗', date: date.toISOString().slice(0,10), start: '15:00', end: '16:00' }], coaching: '장소를 입력하면 이동 시간을 점검할 수 있어요.' }
  fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], JSON.stringify(out))
})
