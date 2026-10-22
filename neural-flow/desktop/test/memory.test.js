// 나에 대한 기억 · 행동 기록 · 배운 점 단위 테스트 (node --test). 실제 CLI 는 부르지 않는다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const memory = require('../main/memory.js')
const memo = require('../main/memo.js')

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-mem-'))
  fs.mkdirSync(path.join(dir, '메모리'))
  fs.mkdirSync(path.join(dir, '지침'))
  fs.writeFileSync(path.join(dir, '메모리', '프로필.md'), '# 프로필\n## 기본\n- 이름: 준상\n## 진로\n- 목표: AI PM / PO\n- 도메인: PropTech\n## 관심사\n- 숏폼\n')
  fs.writeFileSync(path.join(dir, '메모리', '작업방식.md'), '# 작업 방식\n- 질문은 1개만\n')
  fs.writeFileSync(path.join(dir, '지침', '커리어_과목전략.md'), '# 전략\n교통 = 모빌리티 PM 근거\n')
  return dir
}

test('기억 읽기: 진로 절·작업 방식·전략, 앱 비전과 합쳐 프롬프트용으로', () => {
  const dir = fixture()
  const mem = memory.loadMemory(dir)
  assert.ok(mem.ok)
  assert.equal(mem.vision, '- 목표: AI PM / PO\n- 도메인: PropTech')
  const ctx = memory.memoryContext(mem, { vision: { 한줄: '청년 주거 문제 해결' } })
  assert.match(ctx, /\[비전·진로\][\s\S]*AI PM[\s\S]*청년 주거/)
  assert.match(ctx, /\[커리어-과목 전략\][\s\S]*모빌리티/)
  assert.match(ctx, /\[작업 방식\]/)
  assert.ok(!ctx.includes('숏폼')) // 진로 절만
  assert.equal(memory.loadMemory('').ok, false)
  assert.equal(memory.loadMemory(path.join(dir, '없음')).ok, false)
})

test('배운 점 쓰기: 메모리/학습노트.md 하나만, 중복 없이, 폴더 밖 링크는 거부', () => {
  const dir = fixture()
  const before = fs.readFileSync(path.join(dir, '메모리', '프로필.md'), 'utf8')
  let r = memory.appendLearned(dir, ['과목 조각은 15분 이하로', '아침에 계산 문제'], '2026-10-22')
  assert.ok(r.ok)
  assert.equal(r.added, 2)
  r = memory.appendLearned(dir, ['과목 조각은 15분 이하로', '새 줄\n두 줄'], '2026-10-23')
  assert.equal(r.added, 1)
  const text = fs.readFileSync(path.join(dir, '메모리', memory.LEARNED_FILE), 'utf8')
  assert.match(text, /^- \(2026-10-22\) 과목 조각은 15분 이하로$/m)
  assert.match(text, /^- \(2026-10-23\) 새 줄 두 줄$/m)
  assert.equal(fs.readFileSync(path.join(dir, '메모리', '프로필.md'), 'utf8'), before)
  assert.deepEqual(memory.learnedList(memory.loadMemory(dir)).length, 3)
  assert.match(memory.memoryContext(memory.loadMemory(dir)), /\[배운 점 \(사용자가 승인한 것\)\][\s\S]*15분 이하/)
  if (process.platform !== 'win32') {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-out-'))
    const evil = fixture()
    fs.writeFileSync(path.join(other, 'x.md'), 'outside')
    fs.symlinkSync(path.join(other, 'x.md'), path.join(evil, '메모리', memory.LEARNED_FILE))
    assert.equal(memory.appendLearned(evil, ['a'], '2026-10-22').ok, false)
    assert.equal(fs.readFileSync(path.join(other, 'x.md'), 'utf8'), 'outside')
  }
})

const plans = [
  { course: '교통정책론', tree: { concepts: [{ title: 'GC', steps: [{ title: 'a', minutes: 10, done: true }, { title: 'b', minutes: 25, done: false }, { title: 'c', minutes: 25, done: false }] }] } },
]
const signals = [
  { type: 'accept', title: '팀플', changed: ['start'], fit: '높음' },
  { type: 'accept', title: 'GC', changed: [], fit: '중간' },
  { type: 'drop', title: '그냥 생각' },
]

test('행동 기록 통계: 조각 크기·과목별 완료율, 고쳐서 수락한 것, 버린 후보', () => {
  const st = memory.stats(signals, plans)
  assert.deepEqual(st.steps.bySize['≤10분'], { done: 1, total: 1 })
  assert.deepEqual(st.steps.bySize['21~25분'], { done: 0, total: 2 })
  assert.equal(st.edited, 1)
  assert.deepEqual(st.editKinds, { start: 1 })
  assert.equal(st.drops, 1)
  const text = memory.statsText(st)
  assert.match(text, /21~25분 0% \(0\/2\)/)
  assert.match(text, /버린 후보 1개: 그냥 생각/)
})

test('배운 점 제안: 통계·기억을 근거로, 최대 5개, 기록이 적거나 엔진이 없으면 부르지 않음', async () => {
  const mem = memory.loadMemory(fixture())
  let seen = ''
  const call = async (_l, prompt) => {
    seen = prompt
    return { notes: [{ text: '과목 조각은 15분 이하로', why: '25분 조각 0/2' }, { text: '' }, ...Array.from({ length: 8 }, (_, i) => ({ text: `n${i}`, why: '' }))] }
  }
  const r = await memory.reflect({ signals, plans, mem, llm: { provider: 'claude' }, call })
  assert.ok(r.ok)
  assert.equal(r.notes.length, 5)
  assert.equal(r.notes[0].text, '과목 조각은 15분 이하로')
  assert.match(seen, /21~25분 0%/)
  assert.match(seen, /AI PM/)
  let called = false
  const few = await memory.reflect({ signals: [], plans: [], mem, llm: { provider: 'claude' }, call: async () => ((called = true), {}) })
  assert.equal(few.ok, false)
  assert.equal(called, false)
  assert.equal((await memory.reflect({ signals, plans, mem, llm: { provider: 'none' }, call })).ok, false)
})

test('정리·쪼개기 프롬프트에 기억이 들어가고, 종합 평가(접근·적합도·얻을 것·비전·다음 행동)를 정리한다', async () => {
  const ctx = memory.memoryContext(memory.loadMemory(fixture()))
  let seen = ''
  const call = async (_l, prompt) => {
    seen = prompt
    return { items: [{ title: 'GC 계산', lines: [1], approach: '예제부터', fit: '높음', fitWhy: '모빌리티 PM', gain: '계산 감각', vision: 'AI PM', next: '공식 한 번 쓰기' }, { title: '이상한 적합도', lines: [1], fit: '최고' }] }
  }
  const r = await memo.organize({ text: '교통 GC 계산', today: '2026-10-22', memory: ctx, llm: { provider: 'claude' }, call })
  assert.match(seen, /\[비전·진로\][\s\S]*AI PM/)
  assert.deepEqual([r.candidates[0].fit, r.candidates[0].vision, r.candidates[0].next, r.candidates[0].approach], ['높음', 'AI PM', '공식 한 번 쓰기', '예제부터'])
  assert.equal(r.candidates[1].fit, '')
  let seen2 = ''
  await memo.breakdown({ plans: [{ id: 'p', title: 'GC', approach: '예제부터', vision: 'AI PM' }], memory: ctx, llm: { provider: 'claude' }, call: async (_l, p) => ((seen2 = p), { plans: [] }) })
  assert.match(seen2, /\[작업 방식\]/)
  assert.match(seen2, /"approach":"예제부터"/)
})
