# Feature Plan — 회원 관리

## FEAT-001 회원 목록 조회

<!-- web-harness:unit feat=FEAT-001 dependsOn=none -->

관리자가 회원 목록을 본다.

- TC-001-1 목록을 불러오면 회원이 표에 보인다
- TC-001-2 회원이 없으면 빈 상태 안내가 보인다
- TC-001-3 조회가 실패하면 오류와 재시도가 보인다

## FEAT-002 회원 검색·필터

<!-- web-harness:unit feat=FEAT-002 dependsOn=FEAT-001 -->

이름·상태로 목록을 좁힌다.

- TC-002-1 이름으로 검색하면 일치하는 회원만 남는다

## FEAT-003 회원 상세·수정

<!-- web-harness:unit feat=FEAT-003 dependsOn=FEAT-001 -->

목록에서 회원을 골라 정보를 고친다.

- TC-003-1 저장에 성공하면 목록에 바뀐 값이 보인다
- TC-003-2 저장에 실패하면 입력이 유지되고 오류가 보인다
- TC-003-3 다른 관리자가 먼저 고쳤으면 충돌을 알린다 [유예: 편집 충돌 정책이 정해진 뒤]

## FEAT-004 회원 일괄 삭제

<!-- web-harness:unit feat=FEAT-004 dependsOn=FEAT-001 -->

권한 있는 관리자가 여러 회원을 한 번에 지운다.

- TC-004-1 선택한 회원이 모두 지워진다

## FEAT-005 회원 목록 내보내기

<!-- web-harness:unit feat=FEAT-005 dependsOn=FEAT-001 -->

현재 목록을 파일로 내려받는다.

- TC-005-1 내보낸 파일에 현재 목록의 회원이 모두 있다
