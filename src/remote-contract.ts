import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { goModelsRemote, modelsRemote } from './models-contract.ts'
import { usageRemote } from './usage-contract.ts'

/** A registry owns one contribution per package; mount all plugin endpoints together. */
export const zenRemote: TypertRemoteContribution = {
  package: 'dsh-opencode-zen',
  descriptors: [...modelsRemote.descriptors, ...goModelsRemote.descriptors, ...usageRemote.descriptors],
}
