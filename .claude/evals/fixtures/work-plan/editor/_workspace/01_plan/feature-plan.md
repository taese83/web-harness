# Feature Plan — 문서 편집기

## FEAT-011 블록 편집

<!-- web-harness:unit feat=FEAT-011 dependsOn=none -->

문서의 블록을 입력·삭제하고 되돌린다.

- TC-011-1 블록에 입력하면 문서에 반영된다
- TC-011-2 실행 취소하면 직전 상태로 돌아간다

## FEAT-012 개요 패널

<!-- web-harness:unit feat=FEAT-012 dependsOn=none -->

개요 패널에서 블록을 고르면 편집 영역이 그 블록을 선택한다.

- TC-012-1 개요에서 고른 블록이 편집 영역에서도 선택된다

## FEAT-013 로컬 저장·복구

<!-- web-harness:unit feat=FEAT-013 dependsOn=none -->

새로고침해도 편집 중인 문서가 복구된다.

- TC-013-1 새로고침 뒤 마지막 문서가 복구된다
