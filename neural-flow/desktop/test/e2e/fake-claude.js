// 테스트용 가짜 `claude` CLI — `--version` 과 `-p --output-format json` 만 흉내 낸다.
const args = process.argv.slice(2)
if (args.includes('--version')) {
  console.log('9.9.9 (Claude Code · fake)')
  process.exit(0)
}
let input = ''
process.stdin.on('data', (d) => (input += d))
process.stdin.on('end', () => {
  let body
  if (input.includes('일정 코치')) {
    body = { answer: 'CLAUDE 코치: 오늘은 하나만 하세요.', actions: ['20:00 자소서 30분'] }
  } else if (input.includes('일정 비서')) {
    body = { kind: 'task', title: 'CLAUDE: 포트폴리오 정리', date: null, start: null, minutes: 45, domain: '💼 일·소명', reply: 'ok' }
  } else {
    body = { greeting: 'g', one_thing: 'CLAUDE: 오늘의 단 하나', one_thing_why: 'w', holiness_line: 'h', stuck_coaching: 's', trend: '' }
  }
  process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: JSON.stringify(body) }))
})
