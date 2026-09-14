# 트래커 설정 기록 — `configure`

`claim`이 트래커를 물은 뒤(점 0-A) 답을 `_workspace/03_dev/ticket-provider.json`에 기록하는 방법이다.
`team-flow/SKILL.md`에서 옮겨 왔다(2026-09-11 — 스킬 본문 300줄 한도를 줄 병합이 아니라 추출로 지킨다).

**답을 받으면 `configure`로 기록한다** — 사람이 JSON을 손으로 만들게 두지 않는다:

```
cli.mjs configure --provider jira \
  --set baseUrl=… --set apiVersion=2 --set projectKey=… --set issueType=Task \
  --set transitions.in-progress=<id> --set transitions.done=<id>
```

**GitHub이 사내 GitHub Enterprise면 `host`를 기록한다.** 이것을 빠뜨리면 `gh`가
`GH_HOST=github.com`으로 돌아 **존재하지 않는 저장소를 찾는다** — owner/name은 맞게 뽑히고
호스트만 유실되므로, 실패가 "권한 없음"이나 "저장소 없음"으로 보여 원인이 가려진다
(2026-09-02 실측).

```
cli.mjs configure --provider github --set host=github.example.com
```

기본값(`github.com`)이면 적지 않는다 — 설정 파일은 **다른 것만** 담아야 읽을 때 의미가 있다.
호스트는 저장소 원격 URL(`git remote get-url origin`)의 호스트를 **기본값으로 제안**한다.
다만 자동 채택하지 않는다 — 원격이 fork나 미러일 수 있어 조용한 오설정이 된다.

`--confirm` 없이 먼저 돌려 기록될 내용을 보여주고 확인받는다(이 CLI의 공통 규율).
**물을 항목은 결과의 `questions` 배열이 정본이다** — 여기에 옮겨 적지 않는다(갈라진다).
결과의 `needsChoice`·`shared`·`ignored`를 그대로 사용자에게 보여준다: `shared.ignored`가 true면
설정도 원장도 팀에 닿지 않는다(팀 흐름이 로컬 전용이 된다).

기록되는 곳은 `_workspace/03_dev/ticket-provider.json`(원장 옆, **팀 공유**)이고 **토큰은 여기
넣지 않는다** — 허용 키 밖은 거부된다. 인증은 환경변수다.

## 일반화 근거

- **GitHub(github.com)** — 기본값은 기록하지 않는다. `Closes #N`이 자동으로 닫는다.
- **GitHub Enterprise** — `host`를 기록해야 `gh`가 올바른 호스트로 간다(2026-09-02 실측).
- **Jira(Cloud·Data Center)** — 주소·REST 버전·프로젝트·이슈 타입·전이 매핑을 팀 설정에서 받는다(2026-09-09 사내 Jira 실측).

**진실 검증 수준**: GitHub Enterprise `host`와 Jira Data Center 설정은 실측으로 확인했다. Jira Cloud 설정은 fixture 수준이다.
