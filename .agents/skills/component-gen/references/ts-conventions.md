# TypeScript Conventions

Use this reference before generating React or TypeScript code.

## Project Defaults

- Use TypeScript strict mode assumptions for new code.
- Prefer explicit props interfaces over inferred public component props.
- Use `import type` for type-only imports.
- Prefix intentionally unused parameters with `_`.
- Avoid `any`; use `unknown`, generics, or narrow domain types instead.
- Export public types explicitly from the slice `index.ts`.

## React Components

```tsx
import type {FC, ReactNode} from 'react'
import type {SxProps, Theme} from '@mui/material'

interface PanelProps {
  title: string
  children?: ReactNode
  sx?: SxProps<Theme>
}

export const Panel: FC<PanelProps> = ({title, children, sx}) => {
  return (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  )
}
```

## Query And Mutation Types

- Place domain response types in `entities/{entity}/model/types.ts`.
- Keep mutation request types near the feature or entity that owns the mutation.
- Do not copy server state into `useState`; read it from TanStack Query.
- Return `queryClient.invalidateQueries(...)` from mutation `onSettled` when pending state should wait for refetch.
