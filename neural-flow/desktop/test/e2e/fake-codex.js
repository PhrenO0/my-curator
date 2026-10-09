const fs = require('fs')
const args = process.argv.slice(2)
if (args.includes('--version')) { console.log('codex-cli 1.0.0 (fake)'); process.exit(0) }
if (args.includes('login')) { console.log('Logged in using ChatGPT'); process.exit(0) }
let text = ''
process.stdin.on('data', (c) => text += c)
process.stdin.on('end', () => {
  const from = text.match(/오늘:?\s*(\d{4}-\d{2}-\d{2})/)?.[1] || '2026-10-09'
  const date = new Date(from + 'T12:00:00'); date.setDate(date.getDate() + 1)
  const out = text.includes('일정 코치')
    ? { answer: 'CODEX: 약속 사이 이동 시간을 확인하세요.', observations: ['확인된 일정만 검토했어요.'], questions: [] }
    : { items: [{ kind: 'event', title: 'CODEX: 커피챗', date: date.toISOString().slice(0,10), start: '15:00', end: '16:00' }], coaching: '장소를 입력하면 이동 시간을 점검할 수 있어요.' }
  fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], JSON.stringify(out))
})
