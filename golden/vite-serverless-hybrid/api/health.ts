import {withGuards, type GuardConfig} from './_lib/guard'

export const guards: GuardConfig = {
  methods: ['GET'],
  auth: 'public',
  maxBodyBytes: 0,
  schema: null,
  rateLimit: null,
}

export const fetch = withGuards(guards, () => Response.json({status: 'ok'}))

export default {fetch}
