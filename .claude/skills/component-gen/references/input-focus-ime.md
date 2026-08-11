# Input, Focus, And CJK IME

## Enter와 composition

한국어·일본어·중국어 조합 중 Enter는 문자 확정 이벤트이므로 action을 실행하지 않는다.

```tsx
const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
  if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
    submit()
  }
}
```

모든 Enter 기반 submit, tag 추가, inline edit 완료에 같은 guard를 적용한다. `keyCode`나 timeout 추측으로 IME를 판별하지 않는다.

## Menu 또는 Popover 이후 focus

Menu가 닫힐 때 trigger로 focus를 복원하므로, Menu action으로 마운트된 input의 `autoFocus`가 덮일 수 있다. close 완료 다음 frame에 명시적으로 focus하고 cleanup한다.

```tsx
const inputRef = useRef<HTMLInputElement>(null)

useEffect(() => {
  if (!editing) return
  const frameId = requestAnimationFrame(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  })
  return () => cancelAnimationFrame(frameId)
}, [editing])
```

가능하면 Menu의 documented focus props로 먼저 해결한다. frame defer는 실제 restore 충돌이 재현될 때 사용하고 keyboard focus 회귀 테스트를 추가한다.

## URL과 검색 input 분리

URL을 input의 매 keystroke source로 직접 사용하면 navigation render가 composition을 끊을 수 있다. 화면용 local state와 공유 가능한 committed URL state를 분리한다.

```tsx
const [localSearch, setLocalSearch] = useState(urlSearch)
const composingRef = useRef(false)
const timerRef = useRef<ReturnType<typeof setTimeout>>()

const scheduleCommit = (value: string, delay = 200) => {
  if (timerRef.current) clearTimeout(timerRef.current)
  timerRef.current = setTimeout(() => commitSearch(value), delay)
}

useEffect(() => () => {
  if (timerRef.current) clearTimeout(timerRef.current)
}, [])

const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
  const value = event.target.value
  setLocalSearch(value)
  if (!composingRef.current) scheduleCommit(value)
}

const handleCompositionEnd = (event: React.CompositionEvent<HTMLInputElement>) => {
  composingRef.current = false
  scheduleCommit(event.currentTarget.value, 0)
}
```

`commitSearch`는 이전 `URLSearchParams`를 복사해 관련 key만 원자적으로 갱신하고 history spam을 피하려면 replace navigation을 사용한다. 외부 navigation으로 URL이 바뀔 때 local state를 동기화하되 active composition 중에는 덮어쓰지 않는다.

## 검증

- CJK 입력 후 Enter action이 정확히 한 번 실행된다.
- composition 중 URL/navigation update가 없다.
- Menu를 keyboard로 열고 edit를 선택해도 target input에 focus가 간다.
- unmount 뒤 timer나 animation callback이 남지 않는다.

