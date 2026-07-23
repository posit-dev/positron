/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ProviderCatalogChange, ResolvedProvider } from 'ai-config/node';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, toDisposable } from '../../../base/common/lifecycle.js';
import { ILogService } from '../../log/common/log.js';
import { IAiProviderCatalog, IProviderCatalogChangeData, IResolvedProviderData } from '../common/aiProviderCatalog.js';

/**
 * Owns the ai-config catalog lifecycle node-side: initial load, file/env
 * watch, and the resolved config file path. ai-config is ESM-only, so it is
 * loaded via dynamic import (same pattern as headlessLanguageModelEngine's
 * bridge import).
 */
export class AiProviderCatalog extends Disposable implements IAiProviderCatalog {
	private readonly _onDidChangeCatalog = this._register(new Emitter<IProviderCatalogChangeData>());
	readonly onDidChangeCatalog: Event<IProviderCatalogChangeData> = this._onDidChangeCatalog.event;

	private _catalog: Promise<readonly IResolvedProviderData[]> | undefined;
	private _configFilePath: Promise<string> | undefined;
	private _receivedChange = false;

	constructor(
		private readonly _logService: ILogService,
		private readonly _options?: { configPath?: string; envVars?: Record<string, string | undefined> },
	) {
		super();
	}

	private loadOptions(): import('ai-config/node').LoadCatalogOptions {
		return {
			baseline: { defaultEnabled: true },
			configPath: this._options?.configPath,
			envVars: this._options?.envVars,
			logger: {
				debug: (message: string) => this._logService.debug(`[AI Provider Catalog] ${message}`),
				warn: (message: string) => this._logService.warn(`[AI Provider Catalog] ${message}`),
			},
		};
	}

	getCatalog(): Promise<readonly IResolvedProviderData[]> {
		this._catalog ??= this.startCatalog();
		return this._catalog;
	}

	private async startCatalog(): Promise<readonly IResolvedProviderData[]> {
		const aiConfig = await import('ai-config/node');
		const opts = this.loadOptions();
		const watcher = aiConfig.watchResolvedProviderCatalog((change: ProviderCatalogChange) => {
			const catalog = change.catalog.map(toProviderData);
			this._receivedChange = true;
			this._catalog = Promise.resolve(catalog);
			this._onDidChangeCatalog.fire({
				catalog,
				enabledChanged: change.enabledChanged,
				connectionChanged: change.connectionChanged,
				modelsChanged: change.modelsChanged,
			});
		}, opts);
		this._register(toDisposable(() => watcher.dispose()));
		const catalog = await aiConfig.loadResolvedProviderCatalog(opts);
		// A change that arrived while the initial load was in flight already set a
		// newer snapshot; don't let the stale initial load overwrite it.
		return this._receivedChange && this._catalog ? this._catalog : catalog.map(toProviderData);
	}

	getConfigFilePath(): Promise<string> {
		this._configFilePath ??= import('ai-config/node').then(aiConfig =>
			this._options?.configPath ?? aiConfig.PROVIDERS_CONFIG_PATH);
		return this._configFilePath;
	}
}

function toProviderData(provider: ResolvedProvider): IResolvedProviderData {
	const connection = provider.connection;
	return {
		id: provider.id,
		enabled: provider.enabled,
		connection: {
			baseUrl: connection.baseUrl,
			endpoint: connection.endpoint,
			customHeaders: connection.customHeaders,
			aws: connection.aws,
			googleCloud: connection.googleCloud,
			snowflake: connection.snowflake,
		},
	};
}
