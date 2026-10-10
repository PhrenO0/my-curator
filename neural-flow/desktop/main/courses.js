// 과목 자료 폴더 연계 — exam-study 같은 레포의 `과목/<과목명>/` 구조를 읽어
// 과목별 시험일(D-day)과 시험 전략·강의 정보를 AI 코치에 넘긴다. 읽기 전용이다.
//
//   <폴더>/과목/<과목명>/README.md        강의 정보·평가 비율·학기 일정
//   <폴더>/과목/<과목명>/시험전략.md      시험일·범위·우선순위
//   <폴더>/과목/<과목명>/{주차,녹음,오답,anki}/…  (개수만 센다)
//   <폴더>/계획/공부일정_*.md             가장 최근 파일만
//   <폴더>/리듬.md                        수면·교회·상한 같은 규칙

const fs = require('fs')
const path = require('path')
const A = require('../renderer/shared/agenda.js')

const MAX_FILE = 16 * 1024 // 파일 하나에서 읽는 최대 크기
const MAX_COURSES = 30

// 폴더 밖으로 나가는 심볼릭 링크는 읽지 않는다
function inside(root, target) {
  try {
    const r = fs.realpathSync(root)
    const t = fs.realpathSync(target)
    return t === r || t.startsWith(r + path.sep)
  } catch {
    return false
  }
}

function readText(root, file, max = MAX_FILE) {
  try {
    if (!inside(root, file)) return ''
    const st = fs.statSync(file)
    if (!st.isFile()) return ''
    const fd = fs.openSync(file, 'r')
    try {
      const buf = Buffer.alloc(Math.min(st.size, max))
      fs.readSync(fd, buf, 0, buf.length, 0)
      return buf.toString('utf8')
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return ''
  }
}

function countFiles(root, dir, re) {
  try {
    if (!inside(root, dir)) return 0
    return fs.readdirSync(dir).filter((f) => re.test(f)).length
  } catch {
    return 0
  }
}

// "| 날짜 | 10/21(수) 12:00–13:15, 203관 …" 에서 시험 날짜·시각을 뽑는다
function parseExam(text, today) {
  const m = /\|\s*날짜\s*\|\s*(?:(\d{4})[-./])?(\d{1,2})[/.-](\d{1,2})(?:\s*\([^)]*\))?\s*(?:(\d{1,2}):(\d{2}))?\s*[–~-]?\s*(?:(\d{1,2}):(\d{2}))?/.exec(text || '')
  if (!m) return null
  const year = Number(m[1]) || Number(String(today).slice(0, 4))
  let date = `${year}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`
  if (!m[1] && date < A.addDays(today, -60)) date = `${year + 1}${date.slice(4)}` // 한참 지난 날짜면 내년
  if (Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) return null
  const hm = (h, mi) => (h != null ? `${String(h).padStart(2, '0')}:${mi}` : null)
  return { date, start: hm(m[4], m[5]), end: hm(m[6], m[7]), dday: A.diffDays(today, date) }
}

// 과목 폴더가 `…/과목` 이든 그 상위든 받아 준다 → { root, base }
function courseRoot(dir) {
  if (!dir) return null
  const isDir = (p) => {
    try {
      return fs.statSync(p).isDirectory()
    } catch {
      return false
    }
  }
  if (isDir(path.join(dir, '과목'))) return { root: dir, base: path.join(dir, '과목') }
  if (path.basename(dir) === '과목' && isDir(dir)) return { root: path.dirname(dir), base: dir }
  return null
}

function loadCourses(dir, today = A.ymd(new Date())) {
  const found = courseRoot(dir)
  if (!found) return { ok: false, courses: [], message: dir ? "'과목' 폴더를 찾지 못했어요" : '' }
  const { root, base } = found
  const courses = []
  for (const name of fs.readdirSync(base).sort()) {
    if (courses.length >= MAX_COURSES) break
    const cdir = path.join(base, name)
    let st
    try {
      st = fs.statSync(cdir)
    } catch {
      continue
    }
    if (!st.isDirectory() || name.startsWith('.') || !inside(root, cdir)) continue
    const readme = readText(root, path.join(cdir, 'README.md'))
    const strategy = readText(root, path.join(cdir, '시험전략.md'))
    if (!readme && !strategy) continue // 자료가 없는 빈 폴더는 과목으로 보지 않는다
    courses.push({
      name,
      readme,
      strategy,
      exam: parseExam(strategy, today) || parseExam(readme, today),
      notes: countFiles(root, path.join(cdir, '주차'), /\.md$/) + countFiles(root, path.join(cdir, '녹음'), /\.md$/),
      textbooks: countFiles(root, cdir, /^교과서.*\.md$/),
      anki: countFiles(root, path.join(cdir, 'anki'), /\.apkg$/),
    })
  }
  return { ok: true, root, courses }
}

// 계획·리듬 문서: 가장 최근 공부 일정 파일 + 리듬.md
function loadPlanDocs(root) {
  const out = { plan: '', planName: '', rhythm: '' }
  if (!root) return out
  try {
    const dir = path.join(root, '계획')
    const files = fs.readdirSync(dir).filter((f) => /^공부일정.*\.md$/.test(f)).sort()
    if (files.length) {
      out.planName = files[files.length - 1]
      out.plan = readText(root, path.join(dir, out.planName), 8 * 1024)
    }
  } catch {}
  out.rhythm = readText(root, path.join(root, '리듬.md'), 8 * 1024)
  return out
}

// 화면에 보여 줄 가벼운 요약 (본문은 보내지 않는다)
function summarize(loaded) {
  return (loaded.courses || [])
    .map((c) => ({ name: c.name, exam: c.exam, notes: c.notes, textbooks: c.textbooks, anki: c.anki }))
    .sort((a, b) => (a.exam?.date || '9999').localeCompare(b.exam?.date || '9999'))
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}\n…(이하 생략)` : s)

// AI 에 줄 자료 묶음. course 를 주면 그 과목만 자세히, 아니면 모든 과목을 짧게.
function buildContext(loaded, { course = '', today, maxChars = 14000 } = {}) {
  const list = (loaded.courses || []).filter((c) => !course || c.name === course)
  if (!list.length) return ''
  const per = Math.max(1200, Math.floor(maxChars / list.length))
  return list
    .map((c) => {
      const exam = c.exam ? `시험 ${c.exam.date}${c.exam.start ? ` ${c.exam.start}` : ''} (D${c.exam.dday >= 0 ? '-' : '+'}${Math.abs(c.exam.dday)})` : '시험일 미확인'
      const strategyShare = Math.floor(per * 0.7)
      const body = c.strategy ? `[시험 전략]\n${clip(c.strategy, strategyShare)}` : `[강의 정보]\n${clip(c.readme, per)}`
      const info = c.strategy && c.readme ? `\n[강의 정보]\n${clip(c.readme, per - strategyShare)}` : ''
      return `### ${c.name} — ${exam} · 정리된 노트 ${c.notes}개 · 교과서 ${c.textbooks}개 · Anki ${c.anki}벌\n${body}${info}`
    })
    .join('\n\n')
}

module.exports = { loadCourses, loadPlanDocs, summarize, buildContext, parseExam, courseRoot }
