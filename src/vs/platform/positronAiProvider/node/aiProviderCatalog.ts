/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ProviderCatalogChange, ResolvedProvider } from 'ai-config/node';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, toDisposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { ILogService } from '../../log/common/log.js';
import { IAiProviderCatalog, IProviderCatalogChangeData, IResolvedConnectionData, IResolvedProviderData } from '../common/aiProviderCatalog.js';

/** The slice of the ai-config module {@link toProviderData} needs. */
interface IProviderMappingContext {
	isBuiltinProviderId(id: string): boolean;
	readonly PROVIDER_CONNECTION_DEFAULTS: Readonly<Record<string, IResolvedConnectionData | undefined>>;
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
		},
	) {
		super();
	}

	private loadOptions(): import('ai-config/node').LoadCatalogOptions {
		return {
			configPath: this._options?.configPath,
			envVars: this._options?.envVars,
			// PROVIDER-SETTINGS-MIGRATION(legacy-positron): keep the legacy
			// POSITRON_ENFORCED_SETTINGS admin channel applying above the user
			// file. The user-set legacy settings reader is deliberately NOT
			// passed: this Positron migrates those settings into providers.json,
			// and a reader layer would make a cleared providers.json value fall
			// back to its stale legacy source.
			legacyPositronEnforcedSettings: true,
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
		const map = (provider: ResolvedProvider) => toProviderData(provider, aiConfig);
		const watcher = aiConfig.watchResolvedProviderCatalog((change: ProviderCatalogChange) => {
			this._catalog = change.catalog.map(map);
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
		return this._catalog ?? catalog.map(map);
	}

	getConfigFileUri(): Promise<URI> {
		// URI.file encodes the host's native path (e.g. a Windows drive path).
		this._configFileUri ??= import('ai-config/node').then(aiConfig =>
			URI.file(this._options?.configPath ?? aiConfig.PROVIDERS_CONFIG_PATH));
		return this._configFileUri;
	}
}

function toProviderData(provider: ResolvedProvider, aiConfig: IProviderMappingContext): IResolvedProviderData {
	const connection = provider.connection;
	const builtin = aiConfig.isBuiltinProviderId(provider.id);
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
			databricks: connection.databricks,
		},
		models: provider.models,
		custom: builtin ? undefined : true,
		customizedConnection: customizedConnectionFields(
			connection,
			builtin ? aiConfig.PROVIDER_CONNECTION_DEFAULTS[provider.id] : undefined,
		),
	};
}

/**
 * The connection fields whose resolved value differs from the provider's
 * built-in defaults, as dotted names. The resolved connection alone reads as
 * "customized" on a stock install, because ai-config layers built-in defaults
 * (positai's baseUrl, ollama's endpoint, google-vertex's location) under the
 * user/enforced config; diffing against those defaults recovers "set by the
 * user or an administrator". For a custom provider there are no defaults, so
 * every set field counts -- accurate, since its whole connection is
 * user-defined. Names only: no value this function reads reaches its result.
 * @param connection The provider's resolved connection.
 * @param defaults ai-config's built-in defaults for the provider, when it has any.
 */
export function customizedConnectionFields(
	connection: IResolvedConnectionData,
	defaults: IResolvedConnectionData | undefined,
): string[] | undefined {
	const fields: string[] = [];
	if (connection.baseUrl !== undefined && connection.baseUrl !== defaults?.baseUrl) {
		fields.push('baseUrl');
	}
	if (connection.endpoint !== undefined && connection.endpoint !== defaults?.endpoint) {
		fields.push('endpoint');
	}
	// No built-in default carries headers, so any non-empty map is the user's.
	if (connection.customHeaders && Object.keys(connection.customHeaders).length > 0) {
		fields.push('customHeaders');
	}
	const groups: Record<string, [Record<string, unknown> | undefined, Record<string, unknown> | undefined]> = {
		aws: [connection.aws, defaults?.aws],
		googleCloud: [connection.googleCloud, defaults?.googleCloud],
		snowflake: [connection.snowflake, defaults?.snowflake],
		databricks: [connection.databricks, defaults?.databricks],
	};
	for (const [group, [values, defaultValues]] of Object.entries(groups)) {
		for (const [name, value] of Object.entries(values ?? {})) {
			if (value !== undefined && value !== defaultValues?.[name]) {
				fields.push(`${group}.${name}`);
			}
		}
	}
	return fields.length > 0 ? fields : undefined;
}
