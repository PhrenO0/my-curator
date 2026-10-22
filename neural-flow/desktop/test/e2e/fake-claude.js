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
  if (input.includes('메모를 일정·할 일로 정리하는 비서')) {
    // 메모 줄마다 후보 하나 + 메모에 없는 줄(99)을 근거로 지어낸 후보 하나 (앱이 버려야 함)
    const today = (input.match(/오늘 (\d{4}-\d{2}-\d{2})/) || [])[1] || '2026-10-22'
    const t = new Date(today + 'T12:00:00'); t.setDate(t.getDate() + 1)
    const memo = input.split('[메모]\n')[1]?.split('\nJSON 형식')[0] || ''
    const items = memo.split('\n').map((l) => /^(\d+): (.*)$/.exec(l)).filter(Boolean).map(([, n, text]) =>
      /3시/.test(text)
        ? { title: text.replace('내일 3시 ', ''), date: t.toISOString().slice(0, 10), start: '15:00', minutes: 60, course: '', note: '', lines: [Number(n)] }
        : { title: text, date: null, start: null, minutes: null, course: /GC/.test(text) ? '교통정책론' : '', note: '', lines: [Number(n)] })
    const vision = input.includes('[비전·진로]') && input.includes('AI PM') ? 'AI PM' : ''
    const learned = input.includes('15분 이하로 쪼갠다')
    for (const it of items) Object.assign(it, { approach: learned ? '배운 점대로 15분 조각' : '예제부터', fit: vision ? '높음' : '', fitWhy: vision ? '모빌리티 PM 근거' : '', gain: '계산 감각', vision, next: '공식 한 번 쓰기' })
    items.push({ title: 'CLAUDE 가 지어낸 일', date: null, start: null, lines: [99] })
    body = { items, questions: ['팀플 장소는 어디예요?'] }
  } else if (input.includes('일하는 방식을 관찰해 개선점을 찾는 코치')) {
    body = { notes: [{ text: '과목 조각은 15분 이하로 쪼갠다', why: input.includes('21~25분') ? '25분 조각 완료율이 낮음' : '기록' }, { text: '버린 메모 유형은 일정으로 만들지 않는다', why: '버린 후보 1개' }] }
  } else if (input.includes('아주 작은 단위로 쪼개는 코치')) {
    const ids = [...input.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1])
    body = { plans: ids.map((id) => ({ id, concepts: [{ title: '개념 A', steps: [{ title: '공식 외우기', minutes: 10 }, { title: '예제 1 손으로 풀기', minutes: 40 }] }, { title: '개념 B', steps: [{ title: '예시 1줄 쓰기', minutes: 2 }] }] })).concat([{ id: 'unknown', concepts: [{ title: 'x', steps: [{ title: 'y', minutes: 10 }] }] }]) }
  } else if (input.includes('붙여넣은 공문')) {
    body = { title: 'CLAUDE: AI 설명회', date: '2026-10-12', start: '20:00', minutes: 90, location: '온라인', link: null, summary: '무료 설명회', domain: '' }
  } else if (input.includes('새 일정 후보')) {
    body = { verdict: '추천', energy: '여유', strategy: 'CLAUDE 전략: 커리어 목표와 맞음', advice: '참석하세요', facts: [args.includes('WebSearch') && input.includes('조사 규칙') ? 'WEB 확인' : 'NO WEB'] }
  } else if (input.includes('일정 코치')) {
    body = { answer: 'CLAUDE 코치: 오늘은 하나만 하세요.', actions: ['20:00 자소서 30분'] }
  } else if (input.includes('일정 비서')) {
    body = { kind: 'task', title: 'CLAUDE: 포트폴리오 정리', date: null, start: null, minutes: 45, domain: '💼 일·소명', reply: 'ok' }
  } else {
    body = { greeting: 'g', one_thing: 'CLAUDE: 오늘의 단 하나', one_thing_why: 'w', holiness_line: 'h', stuck_coaching: 's', trend: '' }
  }
  process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: JSON.stringify(body) }))
})
