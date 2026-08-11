# 이미 API가 있는 프로젝트에 MSW 추가

real API에 붙어서 돌아가고 있는 프로젝트에 MSW를 뒤늦게 넣는 경우.

## 순서

1. **현재 client 코드에서 endpoint 카탈로그 추출**
   - `grep -rn "fetch(" src/`, `grep -rn "axios\." src/`
   - method, path, request/response shape을 표로 정리
2. **각 endpoint의 실 응답을 캡처**
   - dev/staging에서 `curl` 또는 브라우저 network tab export
   - 개인정보 제거 후 fixture 후보로 사용
3. **response shape을 schema로 codify**
   - Zod schema로 정의 → client와 handler가 모두 참조
   - drift가 남아있으면 이 시점에 노출된다
4. **handler를 하나씩 추가하며 detect**
   - `onUnhandledRequest: 'warn'`으로 잠깐 두고 dev 실행
   - warn 목록 = mock 안 된 endpoint 카탈로그
   - 하나씩 handler로 채워나감
5. **prod에서 절대 활성화 안 되게 gate**
   - `import.meta.env.DEV && import.meta.env.VITE_MSW === '1'`

## 부분 mock 패턴

전부 mock 안 해도 됨. 특정 feature만:
- 개발 중인 feature → mock
- 안정된 feature → real API bypass

`onUnhandledRequest: 'bypass'`가 이걸 지원한다. 부분 mock이 기본값.

## 캡처 시 주의

- Set-Cookie / Authorization 헤더 → **절대 커밋 금지**
- user_id, email, session token → 마스킹
- 실제 URL의 host → localhost/mock으로 치환
- `.env.local`이나 secret이 응답에 섞여있지 않은지 확인
