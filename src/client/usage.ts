import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { GoUsageProbe } from '../usage-contract.ts'
import { UsagePill } from './UsagePill.tsx'
import type { OpencodeZenKey } from './locales.ts'

/**
 * Mount the Go quota pill in the conversation composer. The pill itself asks
 * for nothing until the selected model belongs to the Go plan, so a reader who
 * never picks one sends no usage traffic.
 * @param ctx - the client root context.
 */
export function registerUsagePill(ctx: Context): void {
  ctx.inject(['modelDirectories', 'sessions', 'remote.session'], scope => {
    scope.inject(['remote.opencodeGoUsage'], ready => {
      const readUsage = async (): Promise<GoUsageProbe> => {
        const result = await ready.remote.opencodeGoUsage.read()
        // A remote fault is an unknown, never a verdict about the account.
        return result.ok ? result.value : { status: 'unknown', message: result.error.message }
      }
      const translate = ready.locale.bind('settings.opencode-zen')
      ready.slots.inject('conversation.input.right', () => ready.slots.register({
        name: 'conversation.input.right', id: 'opencode-zen-go-usage', order: 1000,
        inject: sessionId => ({
          directory: ready.modelDirectories.directoryFor(sessionId as SessionId).store,
          readUsage,
          t: (key: string) => translate(key as OpencodeZenKey),
        }),
      }, UsagePill))
    })
  })
}
