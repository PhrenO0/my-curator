// 학기 로드맵 역산 단위 테스트 (node --test). 실제 CLI 는 부르지 않는다.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const courses = require('../main/courses.js')
const roadmap = require('../main/roadmap.js')
const studyPlan = require('../main/study-plan.js')

const today = '2026-10-22'
const claude = { provider: 'claude' }

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-rm-'))
  const w = (rel, text) => {
    const f = path.join(dir, rel)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, text)
  }
  w('과목/교통정책론/README.md', '# 교통정책론\n')
  w('과목/교통정책론/시험전략.md', '# 시험 전략\n| 날짜 | 10/21(수) 12:00 |\n우선순위 1: GC 계산\n')
  w('과목/교통정책론/주차/05주차_접근성.md', '# 5주차 접근성\nHansen 식\n')
  return courses.loadCourses(dir, today)
}

const stage = (title, start, end, steps) => ({ title, start, end, goal: 'g', concepts: [{ title: '개념', steps }] })

test('로드맵 정리: 기간을 오늘~목표일로 자르고, 조각 5~25분, 넘긴 노트만 src', () => {
  const raw = {
    stages: [
      stage('총정리', '2026-12-10', '2026-12-20', [{ title: '인출', minutes: 40 }]),
      stage('1순위', '2026-10-01', '2026-11-05', [{ title: 'Hansen 예제', minutes: 2, src: '주차/05주차_접근성.md' }, { title: '지어냄', minutes: 10, src: '주차/99.md' }]),
      stage('날짜 오류', '11/1', '2026-11-10', [{ title: 'x', minutes: 10 }]),
      stage('목표 뒤', '2026-12-20', '2026-12-30', [{ title: 'x', minutes: 10 }]),
      stage('빈 단계', '2026-11-06', '2026-11-10', []),
    ],
  }
  const { stages, warnings } = roadmap.sanitize(raw, { today, target: '2026-12-15', allowedSrc: ['주차/05주차_접근성.md'] })
  assert.deepEqual(stages.map((s) => s.title), ['1순위', '총정리'])
  assert.equal(stages[0].start, today) // 지난 시작일은 오늘로
  assert.equal(stages[1].end, '2026-12-15') // 목표일 넘는 끝은 목표일로
  assert.deepEqual(stages[0].concepts[0].steps.map((s) => [s.minutes, s.src]), [[5, '주차/05주차_접근성.md'], [10, undefined]])
  assert.equal(stages[1].concepts[0].steps[0].minutes, 25)
  assert.equal(warnings.length, 3)
})

test('부하 경고: 주당 시간을 넘으면 알려 줌', () => {
  const steps = Array.from({ length: 8 }, (_, i) => ({ title: `s${i}`, minutes: 25 })) // 200분 / 7일
  const { warnings } = roadmap.sanitize({ stages: [stage('빡빡', '2026-10-23', '2026-10-29', steps)] }, { today, target: '2026-12-15', hoursPerWeek: 2 })
  assert.match(warnings[0], /부하: 빡빡 — 주당 약 3시간 \(설정 2시간\)/)
})

test('제안: 프롬프트에 목표·주당 시간·노트·기억, 목표일 검사, AI 없으면 안내', async () => {
  const loaded = fixture()
  let prompt = ''
  const call = async (_l, p) => {
    prompt = p
    return { summary: '거꾸로', stages: [stage('1순위', '2026-10-23', '2026-11-10', [{ title: 'Hansen 예제', minutes: 15, src: '주차/05주차_접근성.md' }])], questions: ['형식?'] }
  }
  const notes = courses.pickNotes(loaded, '교통정책론', 'Hansen')
  const r = await roadmap.propose({ loaded, course: '교통정책론', target: { label: '기말고사', date: '2026-12-15' }, hoursPerWeek: 5, today, notes, memory: '[작업 방식]\n- 15분 조각', llm: claude, call })
  assert.ok(r.ok)
  assert.match(prompt, /거꾸로 설계하는 코치/)
  assert.match(prompt, /'교통정책론' 과목의 '기말고사'\(2026-12-15, 오늘 2026-10-22부터 54일 남음\)/)
  assert.match(prompt, /약 5시간/)
  assert.match(prompt, /\[주차 노트 일부\]\n### 주차\/05주차_접근성\.md/)
  assert.match(prompt, /15분 조각/)
  assert.equal(r.draft.stages[0].concepts[0].steps[0].src, '주차/05주차_접근성.md')
  assert.deepEqual(r.draft.questions, ['형식?'])
  assert.equal((await roadmap.propose({ loaded, course: '교통정책론', target: { date: today }, today, llm: claude, call })).ok, false)
  assert.equal((await roadmap.propose({ loaded, course: '없는과목', target: { date: '2026-12-15' }, today, llm: claude, call })).ok, false)
  assert.match((await roadmap.propose({ loaded, course: '교통정책론', target: { date: '2026-12-15' }, today, llm: null, call })).message, /AI 가 필요/)
})

test('다시 배분: 끝낸 조각은 빼라고 넘기고 archived 로 이어 감', async () => {
  const loaded = fixture()
  const previous = {
    course: '교통정책론',
    archived: [{ title: '예전 것', minutes: 10, done: true }],
    stages: [{ id: 'a', title: '1순위', start: '2026-10-10', end: '2026-10-20', concepts: [{ title: 'c', steps: [{ title: '끝낸 것', minutes: 10, done: true }, { title: '남은 것', minutes: 10, done: false }] }] }],
  }
  let prompt = ''
  const call = async (_l, p) => {
    prompt = p
    return { stages: [stage('밀린 것', '2026-10-23', '2026-10-30', [{ title: '남은 것', minutes: 10 }])] }
  }
  const r = await roadmap.propose({ loaded, course: '교통정책론', target: { label: '기말', date: '2026-12-15' }, today, previous, llm: claude, call })
  assert.match(prompt, /\[지난 로드맵\][\s\S]*"done":\["예전 것","끝낸 것"\][\s\S]*"left":\[\{"title":"1순위"[\s\S]*"steps":\["남은 것"\]/)
  assert.deepEqual(r.draft.archived.map((s) => s.title), ['예전 것', '끝낸 것'])
  assert.deepEqual(roadmap.progress(r.draft), { done: 2, total: 3, minutes: 10 })
})

test('단계 상태·이번 주 조각(밀린 것 먼저)·과목별 주간 부하', () => {
  const rm = {
    course: '교통정책론',
    hoursPerWeek: 3,
    stages: [
      { id: 'a', title: '지난', start: '2026-10-10', end: '2026-10-20', concepts: [{ title: 'c', steps: [{ title: '밀린 조각', minutes: 20, done: false }] }] },
      { id: 'b', title: '지금', start: '2026-10-21', end: '2026-10-27', concepts: [{ title: 'c', steps: [{ title: '이번 조각', minutes: 10, done: false }, { title: '끝', minutes: 10, done: true }] }] },
      { id: 'c', title: '나중', start: '2026-11-20', end: '2026-11-26', concepts: [{ title: 'c', steps: [{ title: '나중 조각', minutes: 25, done: false }] }] },
    ],
  }
  const a = roadmap.stageInfo(rm.stages[0], today, 3)
  const b = roadmap.stageInfo(rm.stages[1], today, 3)
  assert.ok(a.behind && !a.current)
  assert.ok(b.current && !b.behind && b.done === 1)
  assert.deepEqual(roadmap.weekSteps(rm, today).map((s) => [s.title, s.behind]), [['밀린 조각', true], ['이번 조각', false]])
  const load = roadmap.weeklyLoad([rm, { course: '도시빅데이터', stages: [{ title: 'x', start: '2026-10-22', end: '2026-11-04', concepts: [{ title: 'c', steps: [{ title: 'y', minutes: 140, done: false }] }] }] }], today, 5)
  assert.equal(load[0].byCourse['교통정책론'], 30) // 밀린 20 + 이번 주 10
  assert.equal(load[0].byCourse['도시빅데이터'], 70) // 2주에 나눠서
  assert.equal(load[4].byCourse['교통정책론'], 21) // 11/19~25 주: 단계 7일 중 6일
})

test('이번 주 배치: 로드맵 조각을 공부 일정 제안 프롬프트에 넘김', async () => {
  const loaded = fixture()
  let prompt = ''
  const call = async (_l, p) => {
    prompt = p
    return { items: [{ title: '[교통정책론] 밀린 조각', date: '2026-10-23', start: '10:00', minutes: 30, note: '밀린 조각' }] }
  }
  const r = await studyPlan.plan({ loaded, today, timeZone: 'Asia/Seoul', llm: claude, course: '교통정책론', tasks: [{ stage: '지난', concept: 'c', title: '밀린 조각', minutes: 20, behind: true }], call })
  assert.ok(r.ok)
  assert.match(prompt, /\[로드맵 조각\]\n\[\{"단계":"지난","개념":"c","조각":"밀린 조각","분":20,"밀림":true\}\]/)
  assert.match(prompt, /그 조각들만 묶어 블록으로 배치/)
})
