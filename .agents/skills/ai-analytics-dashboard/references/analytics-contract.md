# AI Analytics Contract

## Control Plane

    Natural Language
      -> Metric Resolver
      -> Governed Semantic Layer
      -> Validated Query AST
      -> Cost and Access Policy
      -> Read-only Query Service
      -> Chart Spec + Grounded Insight

## Query Guard

- certified metric·dimension allowlist
- server-enforced tenant와 row policy
- read-only credential
- date range, row, scanned bytes, duration, concurrency 상한
- explain·cost estimate와 cancellation
- bounded result

## Data Plane

`timeseries-dashboard`의 snapshot + stream, bounded buffer, downsampling, Worker, render budget을 재사용한다.

## 평가

- metric resolution
- semantic query exact match
- invalid metric rejection
- tenant leak 0
- query budget violation 0
- chart unit·axis·range
- insight groundedness
