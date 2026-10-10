# Reference Checklist — 데이터 패칭(서버 상태)

허브: `implementation-references.md`(판단 순서·산출물에 드러내지 않기). 항목 ID는 스폰 반환에서만 인용한다(파일로 남는 산출물에는 쓰지 않는다).
재시도·ErrorBoundary로 보낼 오류의 정책은 `error-handling-patterns.md` 「Query 정책」이 정본이다 — 여기서 다시 쓰지 않는다.
출처: TanStack Query https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults ·
https://tanstack.com/query/latest/docs/framework/react/guides/query-keys — 확인 2026-10. 다른 라이브러리(SWR 등)를 쓰면 같은 질문에 그 문서로 답한다.

**유효 기본값은 프로젝트의 QueryClient 설정이 정한다** — 하네스 템플릿은 `error-handling-patterns.md` Query 정책(staleTime 5분, 5xx만 재시도)을
덮어 쓴다. 아래 DATA-3·4는 라이브러리 자체의 기본값이다(설정이 없을 때).

## 쿼리 키

- **DATA-1** 키는 최상위가 배열이고, 직렬화할 수 있으며(결정적으로 해시된다), 그 데이터에 고유하다.
- **DATA-2** 쿼리 함수가 쓰는 **바뀔 수 있는 값은 모두 키에 넣는다** — 빠지면 값이 바뀌어도 다시 가져오지 않는다. 객체 안 키 순서는 무관하고 배열
  원소 순서는 다른 키다. 키는 한 곳(키 팩토리)에서 만든다(도출).

## 기본 동작을 알고 정한다

- **DATA-3** 기본 데이터는 즉시 stale이다 — 새 인스턴스 마운트·창 포커스·네트워크 재연결 때 뒤에서 다시 가져온다. 이 화면에 그게 맞지 않으면
  `staleTime`을 정한다(무효화는 여전히 동작한다). 폴링은 `refetchInterval`로 따로 정한다.
- **DATA-4** 관찰자가 없는 쿼리는 5분 뒤 캐시에서 지워진다(`gcTime`). 실패한 쿼리는 지수 백오프로 3번 조용히 재시도한 뒤 오류가 된다 —
  재시도 정책은 `error-handling-patterns.md`를 따른다.
- **DATA-5** 같은 데이터가 오면 이전 참조를 유지한다(구조적 공유) — 참조 비교에 기대는 하위 컴포넌트가 이 덕에 다시 그려지지 않는다.

## 변경 뒤

- **DATA-6** 변경(mutation) 성공 뒤에는 영향받는 **키 범위**를 무효화하거나 응답으로 캐시를 직접 고친다 — 목록 전체를 매번 다시 받지 않는다.
  낙관적 갱신을 쓰면 실패 시 되돌림과 재조회를 함께 둔다(TanStack Invalidations from Mutations·Optimistic Updates 가이드).
- **DATA-7** 늦게 온 응답이 새 상태를 덮지 않게 한다 — 쿼리 함수는 전달된 `signal`로 취소를 따르고, 변경 응답은 그 사이 대상이 바뀌었는지(삭제·
  다른 요청) 확인한 뒤 반영한다(TanStack Query Cancellation 가이드, 변경 쪽은 도출).
- **DATA-8** 서버 상태를 별도 클라이언트 스토어에 복사하지 않는다 — 화면 상태(열림·선택)만 스토어에 두고 서버 데이터는 쿼리 캐시가 정본이다(도출).

## 일반화 근거

- **웹 앱(SPA)** — 조회·변경·무효화·취소가 모든 서버 상태 화면에 적용된다.
- **Next 앱(서버 컴포넌트 혼용)** — 클라이언트 쪽 쿼리에 같은 규칙, 서버에서 미리 가져온 데이터는 같은 키로 캐시에 싣는다.

명명 수준 — eval·실사용 적용 전.
