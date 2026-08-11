# Enterprise Retrieval Contract

## Ingestion

    Connector
      -> Change Capture
      -> Parse and Normalize
      -> ACL and Metadata
      -> Chunk and Embed
      -> Keyword + Vector Index
      -> Version and Tombstone

## Query

    Query + Server Identity
      -> ACL-filtered Hybrid Search
      -> Rerank
      -> Context Budget
      -> Grounded Answer + Citation

## 필수 Metadata

- sourceId, canonicalUrl, version
- tenant, user·group ACL
- owner, classification
- createdAt, updatedAt
- deletion tombstone
- language

## 평가

- Recall@k, NDCG@k, MRR
- ACL leak 0
- groundedness
- citation correctness·completeness
- no-answer precision
- freshness lag
