// 과목 자료 폴더 연계 · 공부 일정 제안 단위 테스트 (node --test)
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const courses = require('../main/courses.js')
const { plan, sanitize } = require('../main/study-plan.js')

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-study-'))
  const w = (rel, text) => {
    const f = path.join(dir, rel)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, text)
  }
  w('과목/교통정책론/README.md', '# 교통정책론\n중간 35%\n')
  w('과목/교통정책론/시험전략.md', '# 시험 전략\n| 항목 | 내용 | 근거 |\n|---|---|---|\n| 날짜 | 10/21(수) 12:00–13:15, 203관 | 슬라이드 |\n| 비중 | 35% | |\n우선순위 1: GC 계산\n')
  w('과목/교통정책론/주차/3주차.md', 'x')
  w('과목/교통정책론/교과서_1-5주차.md', 'x')
  w('과목/교통정책론/anki/덱.apkg', 'x')
  w('과목/지속가능도시론/README.md', '# 지속\n중간 20%, 날짜 미정\n')
  w('과목/빈폴더/.gitkeep', '')
  w('계획/공부일정_1007-1022.md', '# 계획\n월 근로 09-12\n')
  w('리듬.md', '교회 일요일 13:30-16:00')
  return dir
}

test('과목 폴더 읽기: 과목·시험일·D-day·파일 개수 (빈 폴더는 제외)', () => {
  const dir = fixture()
  const r = courses.loadCourses(dir, '2026-10-10')
  assert.ok(r.ok)
  assert.deepEqual(r.courses.map((c) => c.name), ['교통정책론', '지속가능도시론'])
  const t = r.courses[0]
  assert.deepEqual(t.exam, { date: '2026-10-21', start: '12:00', end: '13:15', dday: 11 })
  assert.equal(t.notes, 1)
  assert.equal(t.textbooks, 1)
  assert.equal(t.anki, 1)
  assert.equal(r.courses[1].exam, null)
  // '과목' 폴더를 직접 줘도 된다
  assert.ok(courses.loadCourses(path.join(dir, '과목'), '2026-10-10').ok)
  assert.equal(courses.loadCourses(path.join(dir, '없는폴더'), '2026-10-10').ok, false)
  assert.equal(courses.loadCourses('', '2026-10-10').ok, false)
  // 화면용 요약에는 본문이 없다
  assert.ok(!JSON.stringify(courses.summarize(r)).includes('GC 계산'))
})

test('컨텍스트: 과목 선택·길이 상한·계획 문서', () => {
  const dir = fixture()
  const r = courses.loadCourses(dir, '2026-10-10')
  const all = courses.buildContext(r, { today: '2026-10-10' })
  assert.match(all, /### 교통정책론 — 시험 2026-10-21 12:00 \(D-11\)/)
  assert.match(all, /### 지속가능도시론 — 시험일 미확인/)
  const one = courses.buildContext(r, { course: '교통정책론', today: '2026-10-10' })
  assert.ok(!one.includes('지속가능도시론'))
  assert.match(one, /GC 계산/)
  fs.writeFileSync(path.join(dir, '과목/교통정책론/시험전략.md'), '가'.repeat(50000))
  const big = courses.buildContext(courses.loadCourses(dir, '2026-10-10'), { today: '2026-10-10', maxChars: 3000 })
  assert.ok(big.length < 4500, `길이 ${big.length}`)
  const docs = courses.loadPlanDocs(dir)
  assert.equal(docs.planName, '공부일정_1007-1022.md')
  assert.match(docs.rhythm, /교회/)
})

test('폴더 밖으로 나가는 링크는 읽지 않는다', { skip: process.platform === 'win32' }, () => {
  const dir = fixture()
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-outside-'))
  fs.writeFileSync(path.join(outside, 'README.md'), '비밀 내용')
  fs.symlinkSync(outside, path.join(dir, '과목', '탈출'))
  fs.symlinkSync(path.join(outside, 'README.md'), path.join(dir, '과목/지속가능도시론/시험전략.md'))
  const r = courses.loadCourses(dir, '2026-10-10')
  assert.ok(!r.courses.some((c) => c.name === '탈출'))
  assert.ok(!JSON.stringify(r).includes('비밀 내용'))
})

const items = [
  { title: '교통정책론', date: '2026-10-12', start: '12:00', end: '13:15' },
  { title: '◦ 공부 블록', date: '2026-10-12', start: '13:30', end: '15:00', free: true },
]

test('제안 검증: 겹침·지난 시각·기간 밖·형식 오류는 AI 응답과 무관하게 제외', () => {
  const raw = {
    items: [
      { title: '[교통정책론] GC 계산', date: '2026-10-12', start: '13:30', minutes: 60, note: '근거' }, // 공부 블록 안 → 허용
      { title: '수업과 겹침', date: '2026-10-12', start: '12:30', minutes: 60 },
      { title: '이미 지남', date: '2026-10-10', start: '08:00', minutes: 60 },
      { title: '기간 밖', date: '2026-10-30', start: '10:00', minutes: 60 },
      { title: '시각 오류', date: '2026-10-12', start: '25:00', minutes: 60 },
      { title: '너무 김', date: '2026-10-12', start: '16:00', minutes: 600 },
      { title: '제안끼리 겹침', date: '2026-10-12', start: '14:00', minutes: 60 },
      { title: 'β 의미 서술', date: '2026-10-12', start: '16:00', minutes: 45 },
    ],
  }
  const { items: kept, dropped } = sanitize(raw, { today: '2026-10-10', days: 7, items, nowMin: 9 * 60, course: '교통정책론' })
  assert.deepEqual(kept.map((k) => k.title), ['[교통정책론] GC 계산', '[교통정책론] β 의미 서술'])
  assert.equal(dropped.length, 6)
  assert.ok(dropped.some((d) => /겹침/.test(d.reason)))
  assert.ok(kept.every((k) => k.kind === 'event' && /^\d{2}:\d{2}$/.test(k.start)))
})

test('공부 일정 제안: 프롬프트에 자료·캘린더가 들어가고, 결과는 저장 전 batch 미리보기', async () => {
  const dir = fixture()
  const loaded = courses.loadCourses(dir, '2026-10-10')
  let seen = ''
  const llm = { provider: 'claude' }
  // 실제 CLI(구독)를 부르지 않도록 호출 함수를 주입한다
  const call = async (_l, prompt) => {
    seen = prompt
    return { summary: '교통 계산 먼저', items: [{ title: '[교통정책론] GC 계산 3회', date: '2026-10-12', start: '13:30', minutes: 60, note: '시험전략 우선순위 1' }], questions: ['지속 중간고사 날짜는?'] }
  }
  {
    const r = await plan({ loaded, docs: courses.loadPlanDocs(dir), items, today: '2026-10-10', nowMin: 600, timeZone: 'Asia/Seoul', llm, course: '교통정책론', call })
    assert.ok(r.ok)
    assert.equal(r.item.kind, 'batch')
    assert.equal(r.item.plan, true)
    assert.equal(r.item.items.length, 1)
    assert.deepEqual(r.item.questions, ['지속 중간고사 날짜는?'])
    assert.match(seen, /GC 계산/) // 시험 전략
    assert.match(seen, /공부일정_1007-1022/) // 기존 계획
    assert.match(seen, /교회/) // 리듬 규칙
    assert.match(seen, /"공부자리":true/) // 한가함 블록
    assert.ok(!seen.includes('지속가능도시론')) // 과목 지정 시 다른 과목 제외
    // 엔진이 없으면 호출하지 않고 안내
    const none = await plan({ loaded, items, today: '2026-10-10', timeZone: 'Asia/Seoul', llm: { provider: 'none' }, call })
    assert.equal(none.ok, false)
  }
})
