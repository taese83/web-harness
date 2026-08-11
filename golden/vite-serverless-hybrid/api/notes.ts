import {withGuards, type GuardConfig, type SchemaResult} from './_lib/guard'

type NoteInput = {title: string}
type Note = NoteInput & {id: number}

const notes: Note[] = []
let nextId = 1

export const resetNotes = (): void => {
  notes.length = 0
  nextId = 1
}

const noteSchema = (body: unknown): SchemaResult<NoteInput> => {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return {ok: false, fields: ['body']}
  }
  const title = (body as Record<string, unknown>).title
  if (typeof title !== 'string' || title.length < 1 || title.length > 100) {
    return {ok: false, fields: ['title']}
  }
  return {ok: true, value: {title}}
}

export const guards: GuardConfig = {
  methods: ['POST'],
  auth: 'bearer',
  maxBodyBytes: 1024,
  schema: noteSchema,
  rateLimit: {limit: 5, windowMs: 60_000},
}

export const fetch = withGuards(guards, (_request, body) => {
  const note: Note = {id: nextId++, ...(body as NoteInput)}
  notes.push(note)
  return Response.json(note, {status: 201})
})

export default {fetch}
