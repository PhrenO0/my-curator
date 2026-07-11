# 헤르메스 유튜브 큐레이션 스킬 (youtube-curator)

> 유튜브 링크를 던지면 헤르메스가 파이프라인에 넣고,
> 파이프라인이 옵시디언 노트 + 노션 GTD 대시보드까지 완성한다.

---

## 기억할 것 (메모리에 1회 주입)
- 노션 YouTube Curator DB: `9f6d921ba2664c2e8a9f737903c2c8d9` (GTD 페이지 하위)
- data source: `f28abd39-6e00-448e-8978-e79dcbbcc69e`
- 파이프라인 트리거: `PhrenO0/my-curator` 저장소에 `repository_dispatch`
  (event_type: `youtube-save`, client_payload: `{ "urls_text": "<URL들>" }`)
- 옵시디언 노트는 `vault/YouTube/` 에 커밋된다 (obsidian-git 으로 동기화)
- 상태 흐름: 📥 수집됨 → 👀 볼 것 → ✅ 시청완료 → 📝 노트작성

---

## 스킬 1 — 링크 받아서 저장 (대화형)
텔레그램으로 유튜브 링크가 오면:
```
1. URL에서 video_id 를 확인한다 (유효하지 않으면 정중히 되묻는다)
2. GitHub API 로 repository_dispatch(youtube-save, urls_text=<링크>) 를 보낸다
3. "저장했어. 몇 분 뒤 노션 대시보드와 옵시디언에 나타날 거야" 라고 답한다
```

## 스킬 2 — 자동 수집 (cron)
```
hermes cron add --name yt-collect --schedule "0 7,22 * * *" \
  --prompt "youtube-curator: my-curator 저장소의 YouTube Curator 워크플로우를 실행해
            워치리스트 신규 영상을 수집하라. 완료 후 새로 수집된 영상 제목들을
            텔레그램으로 짧게 보고하라."
```

## 스킬 3 — 주간 소화 체크 (REMEMBER 루프)
```
hermes cron add --name yt-digest --schedule "0 20 * * 6" \
  --prompt "youtube-curator 주간 정리: 노션 YouTube Curator DB에서 '📥 수집됨' 상태로
            7일 이상 방치된 영상을 세어 보고하라. 3개를 골라 '이번 주말에 볼래?' 라고 묻고,
            답에 따라 상태를 '👀 볼 것'으로 바꾸거나 과감히 삭제를 제안하라.
            수집만 하고 안 보는 것은 지식이 아니다 — 과확장 금지 원칙은 여기도 적용된다."
```

---

## 대화 규칙
1. 링크 저장은 **묻지 말고 즉시** 실행한다 (마찰 0).
2. 수집 보고는 제목만 짧게. 링크 나열로 도배하지 않는다.
3. 같은 영상을 다시 보내면 "이미 있어" 라고만 답한다 (파이프라인이 중복을 걸러준다).
4. 주간 체크에서 안 본 영상이 쌓이면 수집 속도를 **낮추자고** 먼저 제안한다.
