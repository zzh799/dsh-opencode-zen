import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-typert-registry'
import { zenRemote } from './remote-contract.ts'

/** Register once per plugin mount, after either registry activation order. */
export function registerZenRemotes(ctx: Context): void {
  ctx.inject(['typert'], scope => {
    scope.effect(() => scope.typert.register({ package: zenRemote.package, face: 'host', schemas: [],
      model: { services: [], events: [], objects: [] }, invocations: zenRemote.descriptors }))
  })
}
