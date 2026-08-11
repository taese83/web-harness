# Shell and Navigation Components

Primary consumers: component-builder, route-builder

## AppShell

- landmarks: `header`, project `nav`, `main`
- global error banner and read-only badge

## ProjectNavigation

- project name, relative path, plan/design counts, preview status
- selected: background + left bar + `aria-current="page"`
- empty: searched project roots and recovery guidance

## ProjectHeader

- selected project title/path, last scan timestamp, Refresh button
- Refresh preserves current selection when it still exists

## TabList

- native buttons with `role=tab`, ArrowLeft/ArrowRight navigation
- status/count badge may accompany label but not replace it
