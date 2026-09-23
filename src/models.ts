import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { discoverSettingsModels, type OpencodeZenCatalog } from './catalog.ts'
import type { ZenModel } from './models-contract.ts'

/** Uses the same gateway snapshot as the adapter, including models hidden from pickers. */
export class ZenModelsService extends TypertRemoteService {
  constructor(ctx: Context, private readonly options: { catalog: () => OpencodeZenCatalog }) {
    super(ctx, 'opencodeZenModels')
  }

  read(): Promise<readonly ZenModel[]> {
    return discoverSettingsModels(this.options.catalog())
  }
}

/** The Go plan's listing, on its own namespace so the settings page can tell the plans apart. */
export class GoModelsService extends TypertRemoteService {
  constructor(ctx: Context, private readonly options: { catalog: () => OpencodeZenCatalog }) {
    super(ctx, 'opencodeGoModels')
  }

  read(): Promise<readonly ZenModel[]> {
    return discoverSettingsModels(this.options.catalog())
  }
}
