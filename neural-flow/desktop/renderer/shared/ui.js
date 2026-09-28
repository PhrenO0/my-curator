// 화면 공용 헬퍼 (위젯·관리 창 공통)
;(function (root) {
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

  function timeAgo(iso) {
    if (!iso) return ''
    const diff = (Date.now() - new Date(iso)) / 1000
    if (diff < 60) return '방금'
    if (diff < 3600) return `${Math.floor(diff / 60)}분 전`
    if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`
    return `${Math.floor(diff / 86400)}일 전`
  }

  // 영어 발음 — OS 내장 음성(Web Speech API). 인터넷·키 불필요.
  function speak(text, { rate = 0.95 } = {}) {
    const synth = root.speechSynthesis
    if (!synth) return false
    synth.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'en-US'
    u.rate = rate
    const voices = synth.getVoices()
    const v =
      voices.find((x) => /en-US/i.test(x.lang) && /natural|neural|samantha|aria|jenny|google/i.test(x.name)) ||
      voices.find((x) => /^en[-_]US/i.test(x.lang)) ||
      voices.find((x) => /^en/i.test(x.lang))
    if (v) u.voice = v
    synth.speak(u)
    return true
  }
  if (root.speechSynthesis) root.speechSynthesis.getVoices() // 목소리 목록 미리 로드

  function greetingByHour(h) {
    if (h < 5) return '고요한 새벽이에요'
    if (h < 11) return '좋은 아침이에요'
    if (h < 17) return '좋은 오후예요'
    if (h < 21) return '좋은 저녁이에요'
    return '하루를 정리할 시간이에요'
  }

  root.UI = { esc, timeAgo, speak, greetingByHour }
})(self)
