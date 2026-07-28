/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type { LegacySettingsReader, ProviderCatalogChange, ResolvedProvider } from 'ai-config/node';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, toDisposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { ILogService } from '../../log/common/log.js';
import { IAiProviderCatalog, IProviderCatalogChangeData, IResolvedProviderData } from '../common/aiProviderCatalog.js';

/**
 * PROVIDER-SETTINGS-MIGRATION(legacy-positron): a LegacySettingsReader over a
 * configuration service, handed to the catalog loader's
 * `legacyPositronSettings` option. `get` reads `inspect(key).userValue` —
 * the user-set value only, never policy/default values, so enforced settings
 * cannot leak into the non-enforced legacy layer (the loader reads
 * POSITRON_ENFORCED_SETTINGS from the environment itself). The watch is
 * coarse (any config change fires) — the catalog watch debounces and diffs.
 */
export function createConfigurationLegacySettingsReader(
	configurationService: IConfigurationService
): LegacySettingsReader {
	return {
		get: key => configurationService.inspect(key).userValue,
		watch: onChange => configurationService.onDidChangeConfiguration(() => onChange()),
	};
}

/**
 * Owns the ai-config catalog lifecycle node-side: initial load, file/env
 * watch, and the resolved config file path.
 */
export class AiProviderCatalog extends Disposable implements IAiProviderCatalog {
	private readonly _onDidChangeCatalog = this._register(new Emitter<IProviderCatalogChangeData>());
	readonly onDidChangeCatalog: Event<IProviderCatalogChangeData> = this._onDidChangeCatalog.event;

	private _catalog: readonly IResolvedProviderData[] | undefined;
	private _configFileUri: Promise<URI> | undefined;

	constructor(
		private readonly _logService: ILogService,
		private readonly _options?: {
			configPath?: string;
			envVars?: Record<string, string | undefined>;
			// PROVIDER-SETTINGS-MIGRATION(legacy-positron)
			legacyPositronSettings?: LegacySettingsReader;
		},
	) {
		super();
	}

	private loadOptions(): import('ai-config/node').LoadCatalogOptions {
		return {
			baseline: { defaultEnabled: true },
			configPath: this._options?.configPath,
			envVars: this._options?.envVars,
			legacyPositronSettings: this._options?.legacyPositronSettings,
			logger: {
				debug: (message: string) => this._logService.debug(`[AI Provider Catalog] ${message}`),
				warn: (message: string) => this._logService.warn(`[AI Provider Catalog] ${message}`),
			},
		};
	}

	async getCatalog(): Promise<readonly IResolvedProviderData[]> {
		if (!this._catalog) {
			this._catalog = await this.startCatalog();
		}
		return this._catalog;
	}

	private async startCatalog(): Promise<readonly IResolvedProviderData[]> {
		const aiConfig = await import('ai-config/node');
		const opts = this.loadOptions();
		const watcher = aiConfig.watchResolvedProviderCatalog((change: ProviderCatalogChange) => {
			this._catalog = change.catalog.map(toProviderData);
			this._onDidChangeCatalog.fire({
				catalog: this._catalog,
				enabledChanged: change.enabledChanged,
				connectionChanged: change.connectionChanged,
				modelsChanged: change.modelsChanged,
			});
		}, opts);
		this._register(toDisposable(() => watcher.dispose()));
		const catalog = await aiConfig.loadResolvedProviderCatalog(opts);
		// Don't let the stale initial load overwrite a change that raced it.
		return this._catalog ?? catalog.map(toProviderData);
	}

	getConfigFileUri(): Promise<URI> {
		// URI.file encodes the host's native path (e.g. a Windows drive path).
		this._configFileUri ??= import('ai-config/node').then(aiConfig =>
			URI.file(this._options?.configPath ?? aiConfig.PROVIDERS_CONFIG_PATH));
		return this._configFileUri;
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
