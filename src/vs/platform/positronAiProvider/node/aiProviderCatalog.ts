/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { onUnexpectedError } from '../../../base/common/errors.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, MutableDisposable } from '../../../base/common/lifecycle.js';
import { SelfHealingLazyPromise } from '../../../base/common/positron/async.js';
import { URI } from '../../../base/common/uri.js';
import { HeadlessProviderModule } from '../../positronHeadlessLanguageModel/node/headlessProviderModule.js';
import { IAiProviderCatalog, IProviderCatalogChangeData, IResolvedProviderData } from '../common/aiProviderCatalog.js';

/** Serves the provider catalog from the process's provider module. */
export class AiProviderCatalog extends Disposable implements IAiProviderCatalog {
	private readonly _onDidChangeCatalog = this._register(new Emitter<IProviderCatalogChangeData>());
	readonly onDidChangeCatalog: Event<IProviderCatalogChangeData> = this._onDidChangeCatalog.event;

	private readonly _subscription = this._register(new MutableDisposable());
	private readonly _started = new SelfHealingLazyPromise(() => this.startCatalog());
	private _catalog: readonly IResolvedProviderData[] | undefined;

	constructor(private readonly _module: HeadlessProviderModule) {
		super();
		this._register(_module.onDidReselect(() => {
			this._subscription.clear();
			this._catalog = undefined;
			this._started.clear();
			this.getCatalog().then(
				catalog => this._onDidChangeCatalog.fire({
					catalog, enabledChanged: true, connectionChanged: true, modelsChanged: true,
				}),
				onUnexpectedError,
			);
		}));
	}

	async getCatalog(): Promise<readonly IResolvedProviderData[]> {
		await this._started.get();
		return this._catalog ?? [];
	}

	private async startCatalog(): Promise<void> {
		const { providers } = await this._module.get();
		this._subscription.value = providers.onDidChangeCatalog(change => {
			this._catalog = change.catalog;
			this._onDidChangeCatalog.fire(change);
		});
		const catalog = await providers.getCatalog();
		// Don't let the stale initial load overwrite a change that raced it.
		this._catalog ??= catalog;
	}

	async getConfigFileUri(): Promise<URI> {
		// URI.file encodes the host's native path (e.g. a Windows drive path).
		return URI.file((await this._module.get()).providers.configPath);
	}
}
