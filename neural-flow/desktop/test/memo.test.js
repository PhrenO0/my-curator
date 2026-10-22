// 메모장 → 정리 → 수락 → 쪼개기 단위 테스트 (node --test). 실제 CLI 는 부르지 않는다(call 주입).
const test = require('node:test')
const assert = require('node:assert/strict')
const memo = require('../main/memo.js')

const today = '2026-10-22'
const claude = { provider: 'claude' }

test('메모 줄: 빈 줄·✓·✗ 줄은 건너뛰고, 표시는 내용으로 찾아 붙인다', () => {
  const text = '내일 3시 팀플\n\n✓ 끝난 일\n✗ 버린 일\n  교통 GC  \n'
  assert.deepEqual(memo.openLines(text).map((l) => [l.n, l.text]), [[1, '내일 3시 팀플'], [5, '교통 GC']])
  const marked = memo.markLines(text, ['교통 GC', '없는 줄'], memo.MARK_DONE)
  assert.match(marked, /^✓ 교통 GC$/m)
  assert.equal(memo.openLines(marked).length, 1)
  assert.match(memo.markLines('a\nb', ['a'], memo.MARK_DROP), /^✗ a\nb$/)
})

test('후보 모양: 날짜+시각이 있어야 구글 일정, 아니면 앱 할 일 (사용자 규칙)', () => {
  assert.equal(memo.shape({ title: 'x', date: '2026-10-23', start: '15:00' }, today).kind, 'event')
  assert.equal(memo.shape({ title: 'x', date: '2026-10-23', start: null }, today).kind, 'task')
  assert.equal(memo.shape({ title: 'x', date: null, start: '15:00' }, today).kind, 'task')
  const bad = memo.shape({ title: 'x', date: '2026-02-30', start: '25:00', minutes: 9999 }, today)
  assert.deepEqual([bad.date, bad.start, bad.minutes, bad.kind], [null, null, null, 'task'])
})

test('정리: 메모 근거 없는 후보(지어낸 것)·목록에 없는 과목은 버리고, 처리한 줄은 프롬프트에 안 보낸다', async () => {
  let seen = ''
  const call = async (_l, prompt) => {
    seen = prompt
    return {
      items: [
        { title: '팀플 회의', date: '2026-10-23', start: '15:00', minutes: 60, lines: [1] },
        { title: 'GC 계산', course: '교통정책론', lines: [3] },
        { title: '없는 과목', course: '천문학', lines: [3] },
        { title: '지어낸 일', lines: [99] },
        { title: '', lines: [1] },
      ],
      questions: ['장소는?'],
    }
  }
  const r = await memo.organize({ text: '내일 3시 팀플 회의\n✓ 이미 한 일\n교통 GC 계산', today, courses: ['교통정책론'], llm: claude, call })
  assert.ok(r.ok)
  assert.deepEqual(r.candidates.map((c) => [c.title, c.kind, c.course]), [['팀플 회의', 'event', ''], ['GC 계산', 'task', '교통정책론'], ['없는 과목', 'task', '']])
  assert.deepEqual(r.candidates[0].lines, ['내일 3시 팀플 회의'])
  assert.match(seen, /1: 내일 3시 팀플 회의/)
  assert.match(seen, /3: 교통 GC 계산/)
  assert.ok(!seen.includes('이미 한 일'))
  assert.deepEqual(r.questions, ['장소는?'])
  // 새 메모가 없으면 부르지 않는다
  let called = false
  const none = await memo.organize({ text: '✓ a\n✗ b', today, llm: claude, call: async () => ((called = true), {}) })
  assert.equal(none.ok, false)
  assert.equal(called, false)
})

test('정리: AI 엔진이 없으면 규칙으로 날짜·시각만 뽑는다', async () => {
  const r = await memo.organize({ text: '내일 오후 3시 커피챗', today, llm: { provider: 'none' } })
  assert.ok(r.ok)
  assert.equal(r.source, 'rules')
  assert.equal(r.candidates[0].kind, 'event')
  assert.equal(r.candidates[0].start, '15:00')
})

test('쪼개기: 조각 5~25분으로 고정, 개수 상한, 모르는 id·빈 개념은 버림, 진행률 계산', async () => {
  const plans = [{ id: 'p1', title: '[교통정책론] GC 계산', course: '교통정책론' }]
  let seen = ''
  const call = async (_l, prompt) => {
    seen = prompt
    return {
      plans: [
        { id: 'p1', concepts: [{ title: 'GC', steps: [{ title: '공식', minutes: 2 }, { title: '예제', minutes: 90 }] }, { title: '빈 개념', steps: [] }, ...Array.from({ length: 10 }, (_, i) => ({ title: `c${i}`, steps: [{ title: 's', minutes: 10 }] }))] },
        { id: 'zzz', concepts: [{ title: 'x', steps: [{ title: 'y', minutes: 10 }] }] },
      ],
    }
  }
  const r = await memo.breakdown({ plans, contextFor: (c) => `${c} 자료: GC 우선순위 1`, llm: claude, call })
  assert.ok(r.ok)
  assert.deepEqual(Object.keys(r.trees), ['p1'])
  const t = r.trees.p1
  assert.deepEqual(t.concepts[0].steps.map((s) => s.minutes), [5, 25])
  assert.ok(t.concepts.length <= 8)
  assert.ok(!t.concepts.some((c) => c.title === '빈 개념'))
  assert.match(seen, /GC 우선순위 1/)
  t.concepts[0].steps[0].done = true
  assert.deepEqual(memo.progress(t).done, 1)
  assert.equal((await memo.breakdown({ plans, llm: { provider: 'none' }, call })).ok, false)
  assert.equal((await memo.breakdown({ plans: [], llm: claude, call })).ok, false)
})

test('쪼개기: 주차 노트를 프롬프트에 싣고, 넘긴 노트만 src 로 인정', async () => {
  let prompt = ''
  const call = async (_llm, p) => {
    prompt = p
    return { plans: [{ id: 'p1', concepts: [{ title: 'Hansen', steps: [{ title: '예제 풀기', minutes: 10, src: '주차/05주차.md' }, { title: '지어낸 근거', minutes: 10, src: '주차/99주차.md' }] }] }] }
  }
  const r = await memo.breakdown({
    plans: [{ id: 'p1', title: '[교통정책론] Hansen 다시 보기', course: '교통정책론' }],
    notesFor: () => [{ course: '교통정책론', file: '주차/05주차.md', title: '5주차 접근성', text: 'Hansen 식 저항함수' }],
    llm: claude,
    call,
  })
  assert.match(prompt, /\[주차 노트\]\n### 주차\/05주차\.md · 교통정책론 — 5주차 접근성\nHansen 식 저항함수/)
  assert.match(prompt, /"notes":\["주차\/05주차\.md"\]/)
  const steps = r.trees.p1.concepts[0].steps
  assert.equal(steps[0].src, '주차/05주차.md')
  assert.equal(steps[1].src, undefined)
})
