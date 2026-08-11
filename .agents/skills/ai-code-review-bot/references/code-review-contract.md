# AI Code Review Contract

## Pipeline

    Signed Webhook
      -> Queue
      -> Diff and Context Builder
      -> Deterministic Checks + AI Review
      -> Finding Normalizer
      -> Dedupe and Line Mapper
      -> Review Comment

## 최소 Tool

- get_pull_request
- get_diff
- get_file_at_sha
- search_repository
- get_ci_results
- get_security_findings
- create_review_comment

초기 버전에는 merge, approve, branch write tool을 제공하지 않는다.

## Finding Schema

- fingerprint
- category
- severity
- confidence
- file, line
- evidence
- impact
- suggestedFix
- analyzerSource
- modelVersion

## 품질

- precision과 critical recall을 분리 측정
- actionable finding rate
- false-positive와 duplicate budget
- line mapping rate
- developer accepted, dismissed, resolved feedback
