# Enterprise Search Implementation Contract

`retrieval-contract.md`의 ingestion/query 골격을 전제로, 검색 품질을 실제로 좌우하는 구현 결정을 고정한다.

## Chunking

- 문서 타입별 경계 우선: 마크다운/위키는 heading 경계, 표는 행 그룹 + 헤더 반복, 코드 블록은 분할 금지, 슬라이드는 페이지 단위.
- 기본 크기 512~1024 token, overlap 10~15% — 수치는 `ASSUMPTION`으로 기록하고 retrieval eval로 조정한다.
- 각 chunk에 제목 경로(breadcrumb)·문서 제목을 메타로 부착한다 — 본문만 임베딩하면 짧은 chunk가 문맥을 잃는다.

## Embedding 선택 기준

- **한국어 성능이 1급 기준이다** — 영어 벤치마크 상위 모델이 한국어 검색에서 실패하는 사례가 흔하다. 후보 모델은 자사 문서 표본으로 한국어 Recall@k를 직접 측정한 뒤 선택한다.
- 모델·버전을 인덱스 메타에 기록한다. **모델 교체 = 전체 재임베딩**이며 신구 벡터를 한 인덱스에 섞지 않는다.
- 차원 수는 저장·질의 비용과 함께 결정하고 근거를 기록한다.

## Vector Store 선택 기준

- 기존 인프라 우선: Postgres가 이미 있으면 pgvector부터 검토한다 — 전용 스토어는 문서 수·QPS가 그 한계를 실측으로 넘을 때.
- **ACL 필터는 pre-filter여야 한다** — 유사도 top-k를 뽑은 뒤 권한으로 걸러내는 post-filter는 결과 고갈과 leak 위험을 만든다. pre-filter를 지원하지 않는 스토어는 후보에서 제외한다.

## Hybrid·Rerank

- BM25 + dense 결합은 가중치 튜닝보다 **RRF(rank fusion)를 기본**으로 시작한다 — 튜닝 없는 안정 결합.
- 한국어 keyword index는 형태소 분석 tokenizer를 사용한다 (공백 토큰화는 조사·어미에서 무너진다).
- reranker는 hybrid top-k(예: 50)를 최종 k(예: 8)로 줄이는 단계에만 사용한다 — 전체 후보 rerank는 비용 초과.
- 질의-문서 언어 불일치: 교차언어 임베딩을 검증했으면 그대로, 아니면 질의 번역 확장을 명시적 단계로 둔다.

## Index 운영

- 증분 색인이 기본, 전체 재색인 트리거를 명시한다: 임베딩 모델 교체, chunking 정책 변경, 대량 ACL 개편.
- tombstone 전파 SLA를 수치로 (예: 삭제 후 15분 내 검색 제외) — 초과는 `qa-data-access` FAIL.
- 색인 파이프라인 실패 시 last-known-good 인덱스를 유지하고 stale 시각을 답변 UI에 노출한다.

## 평가 추가 항목

- 한국어 질의 Recall@k (영어와 분리 측정)
- pre-filter ACL 하에서의 결과 고갈률 (권한 좁은 사용자의 no-answer 비율)
- 재색인 중 질의 가용성
