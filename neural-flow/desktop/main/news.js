// 최신 정보 수집 — RSS (키 불필요). radar.py 의 'RSS 1차 신호' 부분을 데스크탑용으로 옮긴 것.

const Parser = require('rss-parser')

const parser = new Parser({ timeout: 15000, headers: { 'User-Agent': 'neural-flow-desktop/0.1' } })

async function pullNews(feeds, perFeed = 8) {
  const items = []
  const errors = []
  await Promise.all(
    feeds.map(async (f) => {
      try {
        const feed = await parser.parseURL(f.url)
        for (const it of (feed.items || []).slice(0, perFeed)) {
          items.push({
            title: String(it.title || '').trim(),
            link: it.link || '',
            source: f.name,
            date: it.isoDate || it.pubDate || null,
          })
        }
      } catch (e) {
        errors.push({ name: f.name, message: e.message })
      }
    })
  )
  // 최신순 정렬 + 제목 중복 제거
  items.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
  const seen = new Set()
  const unique = items.filter((i) => i.title && !seen.has(i.title) && seen.add(i.title))
  return { items: unique.slice(0, 40), errors, fetchedAt: new Date().toISOString() }
}

module.exports = { pullNews }
