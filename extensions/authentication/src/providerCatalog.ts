/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { BuiltinProviderBlock, ClientKind, ModelsBlock, ProviderConfigSource, ProviderConfigSourceKind, ProvidersConfig, ResolvedConnection, ResolvedProvider } from 'ai-config';
import type { ProviderCatalogChange } from 'ai-config/node';
import { log } from './log';

/**
 * Structural view of a resolved provider the credential chain reads. Mirrors
 * ai-config's `ResolvedProvider` down to the fields consumers here care about.
 */
export interface ResolvedProviderLike {
	readonly id: string;
	/**
	 * Which client the provider instantiates: a built-in's comes from ai-config's
	 * registry, a custom entry's from its authored `type`. Carried here so an
	 * entry can be presented by its kind without re-reading the file.
	 */
	readonly clientKind: ClientKind;
	readonly enabled: boolean;
	readonly connection: ResolvedConnection;
	readonly models: ModelsBlock | undefined;
}

/**
 * Payload of {@link onDidChangeProviderCatalog}: the providers whose resolved
 * catalog entry changed, which is what the credential chain acts on.
 *
 * An id that has just appeared counts as a connection change, from nothing to
 * something, which is how a new custom provider surfaces.
 */
export interface ProviderCatalogChangeEvent {
	/** Ids whose resolved `connection` JSON differs. */
	readonly changedConnectionIds: string[];
	/** Ids whose resolved `enabled` flipped to false. */
	readonly disabledIds: string[];
}

/**
 * Test seam: `configPath`/`envVars` overrides. Production passes neither, so
 * real user settings never leak into a `configPath`-based fixture.
 */
export interface ProviderCatalogOptions {
	configPath?: string;
	envVars?: Record<string, string | undefined>;
}

let cache = new Map<string, ResolvedProviderLike>();
let watcher: { dispose(): void } | undefined;
let currentOptions: ProviderCatalogOptions | undefined;

const changeEmitter = new vscode.EventEmitter<ProviderCatalogChangeEvent>();

/** Fires with the per-provider diff after the cache has been refreshed. */
export const onDidChangeProviderCatalog: vscode.Event<ProviderCatalogChangeEvent> = changeEmitter.event;

function toMap(catalog: readonly ResolvedProvider[]): Map<string, ResolvedProviderLike> {
	const map = new Map<string, ResolvedProviderLike>();
	for (const provider of catalog) {
		map.set(provider.id, {
			id: provider.id,
			clientKind: provider.clientKind,
			enabled: provider.enabled,
			connection: provider.connection,
			models: provider.models,
		});
	}
	return map;
}

/**
 * Diffs the current cache against `next`, replaces the cache, and fires
 * {@link onDidChangeProviderCatalog} when the diff is non-empty. Both the watch
 * handler and {@link refreshProviderCatalog} funnel through here so a write
 * helper's refresh produces the same per-provider diff an external file edit
 * would.
 */
function applyCatalog(next: readonly ResolvedProvider[]): void {
	const previous = cache;
	const nextMap = toMap(next);

	const changedConnectionIds: string[] = [];
	const disabledIds: string[] = [];
	for (const [id, provider] of nextMap) {
		const before = previous.get(id);
		if (!before || JSON.stringify(before.connection) !== JSON.stringify(provider.connection)) {
			changedConnectionIds.push(id);
		}
		if (before?.enabled === true && provider.enabled === false) {
			disabledIds.push(id);
		}
	}
	// A removal changes nothing about the providers that remain, so it needs its
	// own reason to fire, or listeners keep a deleted entry registered.
	const removed = [...previous.keys()].some(id => !nextMap.has(id));

	cache = nextMap;

	if (changedConnectionIds.length === 0 && disabledIds.length === 0 && !removed) {
		return;
	}
	changeEmitter.fire({ changedConnectionIds, disabledIds });
}

async function loadCatalog(options: ProviderCatalogOptions): Promise<readonly ResolvedProvider[]> {
	const { loadResolvedProviderCatalog } = await import('ai-config/node');
	return loadResolvedProviderCatalog({
		configPath: options.configPath,
		envVars: options.envVars,
		// PROVIDER-SETTINGS-MIGRATION(legacy-positron): keep the legacy
		// POSITRON_ENFORCED_SETTINGS admin channel applying above the user file.
		// The user-set legacy settings reader is deliberately NOT passed: this
		// Positron migrates those settings into providers.json, and a reader
		// layer would make a cleared providers.json value fall back to its
		// stale legacy source.
		legacyPositronEnforcedSettings: true,
		logger: { debug: (m: string) => log.debug(m), warn: (m: string) => log.warn(m) },
	});
}

/**
 * Loads the resolved provider catalog into the cache and starts watching for
 * external changes. Idempotent: a re-init disposes the previous watcher and
 * replaces the cache, so tests can re-init against fresh directories without a
 * stale watcher firing into the shared emitter.
 */
export async function initProviderCatalog(
	context: vscode.ExtensionContext,
	options: ProviderCatalogOptions = {}
): Promise<void> {
	watcher?.dispose();
	watcher = undefined;
	currentOptions = options;

	const { watchResolvedProviderCatalog } = await import('ai-config/node');
	cache = toMap(await loadCatalog(options));
	await logDisabledProviders(options);

	watcher = watchResolvedProviderCatalog(
		(change: ProviderCatalogChange) => applyCatalog(change.catalog),
		{
			configPath: options.configPath,
			envVars: options.envVars,
			// PROVIDER-SETTINGS-MIGRATION(legacy-positron): same opt-in as
			// loadCatalog — enforced channel only, no user-set reader.
			legacyPositronEnforcedSettings: true,
			logger: { debug: (m: string) => log.debug(m), warn: (m: string) => log.warn(m) },
		}
	);
	context.subscriptions.push({ dispose: () => watcher?.dispose() });
}

/**
 * Logs each provider that resolved to `enabled: false` at startup, and whether
 * the user's providers.json or an admin policy disabled it. Answers "why is
 * this provider missing" from the log alone.
 *
 * ai-config doesn't expose which layer decided `enabled` (its `resolveEnabled`
 * is internal), so this repeats that "first layer that defines it wins" walk
 * over the layers `loadConfigSources` returns: enforced, then user, then
 * default. That seam omits the legacy POSITRON_ENFORCED_SETTINGS layer, which
 * ranks between enforced and user; a provider none of the three disables must
 * have been disabled there. A legacy pin that agrees with a user `false` is
 * reported as the user's, which is still true of the file.
 */
async function logDisabledProviders(options: ProviderCatalogOptions): Promise<void> {
	const disabled = [...cache.values()].filter(provider => !provider.enabled).map(provider => provider.id);
	if (disabled.length === 0) {
		return;
	}
	const { loadConfigSources } = await import('ai-config/node');
	// No logger: loadCatalog has already reported these sources' issues.
	const sources = await loadConfigSources({ configPath: options.configPath, env: options.envVars });
	const layer = (kind: ProviderConfigSourceKind) => sources.find(source => source.kind === kind);
	const enforced = layer('enforced');
	const user = layer('user');
	const fallback = layer('default');
	const configPath = await resolveProvidersConfigPath(options);
	for (const id of disabled) {
		if (definesEnabled(enforced, id)) {
			log.info(`Provider ${id} is disabled by an admin policy (${enforced?.label ?? 'POSIT_AI_PROVIDERS_ENFORCED'}), which overrides ${configPath}.`);
		} else if (definesEnabled(user, id)) {
			log.info(`Provider ${id} is disabled in ${configPath}. Set "enabled" to true there to turn it back on.`);
		} else if (definesEnabled(fallback, id)) {
			log.info(
				`Provider ${id} is disabled by an admin default (${fallback?.label ?? 'POSIT_AI_PROVIDERS_DEFAULT'}). `
				+ `Set "enabled" to true in ${configPath} to turn it back on.`
			);
		} else {
			log.info(`Provider ${id} is disabled by an admin policy (POSITRON_ENFORCED_SETTINGS), which overrides ${configPath}.`);
		}
	}
}

/** Whether the admin default layer (POSIT_AI_PROVIDERS_DEFAULT) decides a provider's `enabled`. */
export async function adminDefaultDecidesEnabled(id: string, options: ProviderCatalogOptions = {}): Promise<boolean> {
	const { loadConfigSources } = await import('ai-config/node');
	const sources = await loadConfigSources({ configPath: options.configPath, env: options.envVars });
	return definesEnabled(sources.find(source => source.kind === 'default'), id);
}

/**
 * Whether a config layer decides a provider's `enabled`, either in the
 * provider's own block or in the layer's `default` block -- the same test
 * ai-config's `resolveEnabled` uses to pick the winning layer.
 */
function definesEnabled(source: ProviderConfigSource | undefined, id: string): boolean {
	const providers = source?.config.providers;
	const block = (providers as Record<string, { enabled?: boolean } | undefined> | undefined)?.[id]
		?? providers?.custom?.[id];
	return block?.enabled !== undefined || providers?.default?.enabled !== undefined;
}

/** Synchronous read over the cached catalog; undefined before init. */
export function getCachedProvider(catalogId: string): ResolvedProviderLike | undefined {
	return cache.get(catalogId);
}

/**
 * Reloads the catalog now and fires {@link onDidChangeProviderCatalog} when the
 * reload differs from the cache. `options` overrides the remembered options so a
 * write helper called with `{ configPath }` in a test never reads the real file;
 * without an override it's a no-op before init, so it never falls back to the
 * real providers.json inside a test.
 */
async function refreshProviderCatalog(options?: ProviderCatalogOptions): Promise<void> {
	const opts = options ?? currentOptions;
	if (!opts) {
		return;
	}
	applyCatalog(await loadCatalog(opts));
}

function effectiveOptions(override?: ProviderCatalogOptions): ProviderCatalogOptions {
	return override ?? currentOptions ?? {};
}

/**
 * The providers.json path these helpers read and write: the `configPath`
 * override when a test supplies one, otherwise ai-config's real location. Kept
 * here so callers that only need the path for a message don't have to import
 * ai-config themselves.
 */
export async function resolveProvidersConfigPath(options?: ProviderCatalogOptions): Promise<string> {
	const configPath = effectiveOptions(options).configPath;
	if (configPath) {
		return configPath;
	}
	const { PROVIDERS_CONFIG_PATH } = await import('ai-config/node');
	return PROVIDERS_CONFIG_PATH;
}

/** All providers these helpers write are built-ins, so their blocks are `BuiltinProviderBlock`. */
type BuiltinBlockMap = Record<string, BuiltinProviderBlock>;

/** What ai-config's writer logs through. */
const writeLogger = { debug: (m: string) => log.debug(m), warn: (m: string) => log.warn(m) };

async function mutate(
	mutator: (providers: BuiltinBlockMap) => void,
	options: ProviderCatalogOptions
): Promise<void> {
	const { mutateProvidersConfig } = await import('ai-config/node');
	await mutateProvidersConfig(
		(current: ProvidersConfig): ProvidersConfig => {
			const providers: BuiltinBlockMap = structuredClone(current.providers ?? {});
			mutator(providers);
			return { ...current, providers };
		},
		{ configPath: options.configPath, logger: writeLogger }
	);
	await refreshProviderCatalog(options);
}

/** Writes providers.snowflake-cortex.snowflake.account only when it changed. */
export async function saveSnowflakeAccount(
	account: string,
	options?: ProviderCatalogOptions
): Promise<void> {
	if (getCachedProvider('snowflake-cortex')?.connection.snowflake?.account === account) {
		return;
	}
	const opts = effectiveOptions(options);
	await mutate(providers => {
		const block = providers['snowflake-cortex'] ?? {};
		providers['snowflake-cortex'] = { ...block, snowflake: { ...block.snowflake, account } };
	}, opts);
}

/**
 * Writes providers.databricks.databricks.host only when it changed. The
 * workspace host lives in its own connection section, not `baseUrl`: per-model
 * endpoint resolution falls back to `baseUrl`, so a host there would route chat
 * at the bare workspace and bypass the serving-endpoints path.
 */
export async function saveDatabricksHost(
	host: string,
	options?: ProviderCatalogOptions
): Promise<void> {
	if (getCachedProvider('databricks')?.connection.databricks?.host === host) {
		return;
	}
	const opts = effectiveOptions(options);
	await mutate(providers => {
		const block = providers['databricks'] ?? {};
		providers['databricks'] = { ...block, databricks: { ...block.databricks, host } };
	}, opts);
}

/**
 * Writes providers.<id>.enabled, then refreshes the cache. With `onlyIfUnset`,
 * leaves an already-set `enabled` value untouched.
 *
 * Returns whether the value was written: false means `onlyIfUnset` found an
 * existing `enabled` and left it alone. Callers that report what they did to
 * the user's file need that distinction, which the write itself doesn't
 * surface.
 */
export async function saveProviderEnabled(
	catalogId: string,
	enabled: boolean,
	onlyIfUnset: boolean,
	options?: ProviderCatalogOptions
): Promise<boolean> {
	const opts = effectiveOptions(options);
	let wrote = false;
	await mutate(providers => {
		const block = providers[catalogId] ?? {};
		if (onlyIfUnset && block.enabled !== undefined) {
			return;
		}
		providers[catalogId] = { ...block, enabled };
		wrote = true;
	}, opts);
	return wrote;
}
