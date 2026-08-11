#!/usr/bin/env node

import {readFileSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const librarySetupKeys = new Map([
  ['TanStack Query v5', 'tanstack-query'],
  ['Zustand v5', 'zustand'],
  ['React Hook Form + Zod', 'react-hook-form-zod'],
  ['MUI (Material UI)', 'mui'],
  ['Recharts', 'recharts'],
  ['TanStack Table v8', 'tanstack-table'],
  ['Framer Motion', 'framer-motion'],
  ['react-i18next', 'react-i18next'],
  ['react-dropzone (파일 업로드)', 'react-dropzone'],
  ['@hello-pangea/dnd (드래그 앤 드롭)', 'hello-pangea-dnd'],
  ['socket.io-client (실시간)', 'socket-io-client'],
  ['Tiptap (리치 텍스트 에디터)', 'tiptap'],
])

const catalogs = new Map([
  [
    'project-templates',
    {
      path: '.claude/skills/project-init/assets/templates.md',
      keyFor: heading => heading.match(/^([A-Z][A-Z0-9_]*)/)?.[1] ?? null,
    },
  ],
  [
    'library-setup',
    {
      path: '.claude/skills/lib-advisor/assets/setup-snippets.md',
      keyFor: heading => librarySetupKeys.get(heading) ?? null,
    },
  ],
  [
    // 키를 heading 접두어에서 파생한다 — `library-setup`의 하드코딩 맵과 달리 heading을
    // 추가해도 맵 갱신을 잊어 전체 호출이 exit 2로 죽는 함정이 없다.
    'library-catalog',
    {
      path: '.claude/skills/lib-advisor/assets/lib-catalog.md',
      keyFor: heading => heading.match(/^([A-Z][A-Z0-9_]*)/)?.[1] ?? null,
    },
  ],
])

const parseSections = source => {
  const sections = []
  let current = null
  let fenceMarker = null

  for (const line of source.split(/\r?\n/)) {
    const fenceMatch = line.match(/^\s*(```|~~~)/)
    if (fenceMatch) {
      fenceMarker = fenceMarker === null ? fenceMatch[1] : fenceMarker === fenceMatch[1] ? null : fenceMarker
    }

    const headingMatch = fenceMarker === null ? line.match(/^##\s+(.+?)\s*$/) : null
    if (headingMatch) {
      if (current) sections.push(current)
      current = {heading: headingMatch[1], lines: [line]}
      continue
    }
    if (current) current.lines.push(line)
  }

  if (current) sections.push(current)
  return sections
}

const args = process.argv.slice(2)
const catalogIndex = args.indexOf('--catalog')
const sectionIndex = args.indexOf('--section')
const catalogName = catalogIndex >= 0 ? args[catalogIndex + 1] : null
const sectionName = sectionIndex >= 0 ? args[sectionIndex + 1] : null
const listOnly = args.includes('--list')

if (!catalogName || !catalogs.has(catalogName) || (listOnly === Boolean(sectionName))) {
  process.stderr.write('Usage: read-skill-section.mjs --catalog <project-templates|library-setup> (--list | --section <key>)\n')
  process.exit(2)
}

const catalog = catalogs.get(catalogName)
const source = readFileSync(join(repositoryRoot, catalog.path), 'utf8')
const sections = parseSections(source).map(section => ({...section, key: catalog.keyFor(section.heading)}))
const unkeyedSections = sections.filter(section => !section.key)
if (unkeyedSections.length > 0) {
  process.stderr.write(`Unmapped ${catalogName} sections: ${unkeyedSections.map(section => section.heading).join(', ')}\n`)
  process.exit(2)
}
const duplicateKeys = sections
  .map(section => section.key)
  .filter((key, index, keys) => keys.indexOf(key) !== index)
if (duplicateKeys.length > 0) {
  process.stderr.write(`Duplicate ${catalogName} section keys: ${[...new Set(duplicateKeys)].join(', ')}\n`)
  process.exit(2)
}

if (listOnly) {
  process.stdout.write(`${sections.map(section => `${section.key}\t${section.heading}`).join('\n')}\n`)
  process.exit(0)
}

const section = sections.find(candidate => candidate.key === sectionName)
if (!section) {
  process.stderr.write(`Unknown ${catalogName} section: ${sectionName}\n`)
  process.exit(2)
}

process.stdout.write(`${section.lines.join('\n').trimEnd()}\n`)
