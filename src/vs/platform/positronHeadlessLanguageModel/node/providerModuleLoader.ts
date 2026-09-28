/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { access } from 'fs/promises';
import { pathToFileURL } from 'url';
import { join } from '../../../base/common/path.js';
import { ILogService } from '../../log/common/log.js';

/**
 * The ai-provider-bridge and ai-config/node surface the engine and catalog
 * use. Assistant's provider module and Positron's own compiled-in copy both
 * satisfy this shape; the loader picks between them as one unit -- a partial
 * load (one package but not the other) always falls back entirely, since
 * that combination is never what either product actually ships.
 */
export type ProviderModule = typeof import('ai-provider-bridge')
	& typeof import('ai-provider-bridge/providers')
	& typeof import('ai-provider-bridge/credential-shaping')
	& typeof import('ai-config/node');

/**
 * Loads Assistant's provider module from disk, or Positron's own compiled-in
 * copy on any failure: not installed, disabled, unreadable, or missing an
 * expected export. Never throws.
 */
export async function loadProviderModule(
	folder: string | undefined,
	logService: ILogService,
): Promise<ProviderModule> {
	const assistantModule = folder ? await tryLoadAssistantModule(folder, logService) : undefined;
	if (assistantModule) {
		logService.info('[provider-module] Using Posit Assistant\'s provider module');
		return assistantModule;
	}
	return loadBuiltinProviderModule();
}

async function tryLoadAssistantModule(folder: string, logService: ILogService): Promise<ProviderModule | undefined> {
	const entryPoint = join(folder, 'index.js');
	try {
		await access(entryPoint);
		const loaded = await import(pathToFileURL(entryPoint).href) as Partial<ProviderModule>;
		assertProviderModuleShape(loaded);
		return loaded;
	} catch (error) {
		logService.warn(`[provider-module] Ignoring ${entryPoint}: ${error}`);
		return undefined;
	}
}

/** Deferred so the bridge and its heavy AI-SDK dependencies load only on first use. */
async function loadBuiltinProviderModule(): Promise<ProviderModule> {
	const [bridge, providers, credentialShaping, config] = await Promise.all([
		import('ai-provider-bridge'),
		import('ai-provider-bridge/providers'),
		import('ai-provider-bridge/credential-shaping'),
		import('ai-config/node'),
	]);
	return { ...bridge, ...providers, ...credentialShaping, ...config };
}

const REQUIRED_EXPORTS: readonly (keyof ProviderModule)[] = [
	'ProviderRegistry',
	'registerAllProviders',
	'PROVIDER_MAP',
	'MAPPED_PROVIDER_IDS',
	'POSIT_AI_DEFAULTS',
	'CONFIG_KEY_OVERRIDES',
	'PROVIDERS_CONFIG_PATH',
	'loadResolvedProviderCatalog',
	'watchResolvedProviderCatalog',
	'isBuiltinProviderId',
	'PROVIDER_CONNECTION_DEFAULTS',
];

export function assertProviderModuleShape(loaded: Partial<ProviderModule>): asserts loaded is ProviderModule {
	const missing = REQUIRED_EXPORTS.filter(name => loaded[name] === undefined);
	if (missing.length > 0) {
		throw new Error(`missing export(s): ${missing.join(', ')}`);
	}
}
