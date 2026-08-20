/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { isBuiltinProviderId, type BuiltinProviderBlock, type ClientKind, type CustomProviderEntry, type LegacySettingsReader, type Protocol, type ProvidersConfig, type ResolvedConnection, type ResolvedProvider } from 'ai-config';
import type { ProviderCatalogChange } from 'ai-config/node';
import { ANTHROPIC_DEFAULT_BASE_URL, GEMINI_DEFAULT_BASE_URL, OPENAI_DEFAULT_BASE_URL } from './constants';
import { log } from './log';

/**
 * Structural view of a resolved provider the credential chain reads. Mirrors
 * ai-config's `ResolvedProvider` down to the fields consumers here care about.
 */
export interface ResolvedProviderLike {
	readonly id: string;
	/**
	 * Which client the provider instantiates. Built-ins get theirs from
	 * ai-config's registry, custom entries from their authored `type`. Carried
	 * here so a custom entry can be presented by its kind without re-reading
	 * the file.
	 */
	readonly clientKind: ClientKind;
	readonly enabled: boolean;
	readonly connection: ResolvedConnection;
}

/**
 * Payload of {@link onDidChangeProviderCatalog}, carrying the per-provider
 * granularity the credential chain needs: `changedConnectionIds` (ids whose
 * connection JSON differs) and `disabledIds` (ids whose `enabled` flipped to
 * false). An id that has just appeared counts as a connection change, from
 * nothing to something, which is how a new custom provider surfaces.
 */
export interface ProviderCatalogChangeEvent {
	readonly changedConnectionIds: string[];
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
	// A removed provider changes nothing about the ones that remain, so it needs
	// its own reason to fire: listeners reconcile against the catalog and would
	// otherwise keep a deleted custom entry registered.
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
		baseline: { defaultEnabled: true },
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

	watcher = watchResolvedProviderCatalog(
		(change: ProviderCatalogChange) => applyCatalog(change.catalog),
		{
			baseline: { defaultEnabled: true },
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
export async function refreshProviderCatalog(options?: ProviderCatalogOptions): Promise<void> {
	const opts = options ?? currentOptions;
	if (!opts) {
		return;
	}
	applyCatalog(await loadCatalog(opts));
}

function effectiveOptions(override?: ProviderCatalogOptions): ProviderCatalogOptions {
	return override ?? currentOptions ?? {};
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

// Bare public host -> the versioned form its `@ai-sdk/*` client expects, for the
// providers whose SDK won't add the version segment itself. Mirrors
// ai-provider-bridge's KNOWN_HOSTS. deepseek and vertex are absent on purpose:
// their SDKs use the bare host.
const VERSIONED_HOSTS: Record<string, { bare: string; versioned: string }> = {
	anthropic: { bare: 'https://api.anthropic.com', versioned: ANTHROPIC_DEFAULT_BASE_URL },
	openai: { bare: 'https://api.openai.com', versioned: OPENAI_DEFAULT_BASE_URL },
	gemini: { bare: 'https://generativelanguage.googleapis.com', versioned: GEMINI_DEFAULT_BASE_URL },
};

/**
 * Append the version segment a provider's SDK expects when the saved value is
 * the bare public host, so a bare host never lands in providers.json (the layer
 * the catalog's read-side normalization doesn't touch). Conservative on purpose:
 * only an exact bare-host match is rewritten, so proxies and already-versioned
 * URLs pass through untouched. Foundry has its own Azure-specific normalization.
 */
function normalizeSavedBaseUrl(catalogId: string, baseUrl: string): string {
	const known = VERSIONED_HOSTS[catalogId];
	if (!known) {
		return baseUrl;
	}
	return baseUrl.trim().replace(/\/+$/, '') === known.bare ? known.versioned : baseUrl;
}

/** Writes providers.<id>.baseUrl, then refreshes the cache. */
export async function saveProviderBaseUrl(
	catalogId: string,
	baseUrl: string,
	options?: ProviderCatalogOptions
): Promise<void> {
	const normalized = normalizeSavedBaseUrl(catalogId, baseUrl);
	const opts = effectiveOptions(options);
	await mutate(providers => {
		providers[catalogId] = { ...providers[catalogId], baseUrl: normalized };
	}, opts);
}

/**
 * Removes the providers.<catalogId> block entirely, then refreshes the cache.
 * Used when a provider is removed so its saved connection settings (base URL,
 * protocol, custom models) don't linger and pre-fill a later reconnect. A no-op
 * if the block is already absent.
 */
export async function removeProviderBlock(
	catalogId: string,
	options?: ProviderCatalogOptions
): Promise<void> {
	const opts = effectiveOptions(options);
	await mutate(providers => {
		delete providers[catalogId];
	}, opts);
}

/** Element type of a provider block's explicit custom-model list. */
type CustomModelEntry = NonNullable<NonNullable<BuiltinProviderBlock['models']>['custom']>[number];

/**
 * Writes a custom provider's `protocol` and explicit model list to providers.json.
 * A non-empty model list is stored as `models.custom` with discovery off; an
 * empty list leaves the models block untouched so discovery (the provider's
 * /models endpoint) still applies. An unrecognized protocol is ignored.
 */
export async function saveCustomProviderModels(
	catalogId: string,
	protocol: string | undefined,
	customModels: readonly CustomModelEntry[] | undefined,
	options?: ProviderCatalogOptions
): Promise<void> {
	const { PROTOCOL_VALUES } = await import('ai-config/node');
	const isProtocol = (value: string): value is Protocol => (PROTOCOL_VALUES as readonly string[]).includes(value);
	const opts = effectiveOptions(options);
	await mutate(providers => {
		const block: BuiltinProviderBlock = { ...providers[catalogId] };
		if (protocol && isProtocol(protocol)) {
			block.protocol = protocol;
		}
		if (customModels && customModels.length > 0) {
			block.models = { discovery: 'off', custom: [...customModels] };
		}
		providers[catalogId] = block;
	}, opts);
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
 */
export async function saveProviderEnabled(
	catalogId: string,
	enabled: boolean,
	onlyIfUnset: boolean,
	options?: ProviderCatalogOptions
): Promise<void> {
	const opts = effectiveOptions(options);
	await mutate(providers => {
		const block = providers[catalogId] ?? {};
		if (onlyIfUnset && block.enabled !== undefined) {
			return;
		}
		providers[catalogId] = { ...block, enabled };
	}, opts);
}

// ---------------------------------------------------------------------------
// Custom provider entries (providers.custom.<name>)
// ---------------------------------------------------------------------------

/**
 * The cached custom providers, i.e. everything in the catalog that isn't a
 * built-in key. Their id is the name the user gave the entry.
 */
export function getCachedCustomProviders(): ResolvedProviderLike[] {
	return [...cache.values()].filter(provider => !isBuiltinProviderId(provider.id));
}

/**
 * Reads one custom entry exactly as authored in the user's providers.json,
 * with no enforced, default, or environment overlays applied.
 *
 * Edits read through here rather than through the resolved catalog: editing
 * against the merged view would bake an admin's enforced base URL into the
 * user's own file, and it would stop tracking policy from then on. Undefined
 * means the entry has no user-layer record, so it's either absent or
 * externally managed.
 */
export async function readCustomProviderEntry(
	name: string,
	options?: ProviderCatalogOptions
): Promise<CustomProviderEntry | undefined> {
	const { readUserCustomProviderEntry } = await import('ai-config/node');
	return readUserCustomProviderEntry(name, { configPath: effectiveOptions(options).configPath });
}

/**
 * Writes the entry's URL onto an existing `providers.custom.<name>` entry under
 * the config lock, then refreshes the cache. Everything else the user authored
 * (`customHeaders`, `protocol`, `endpoints`, `models`, `enabled`) is left
 * alone. `type` is not writable here: changing the client kind re-keys the
 * credential and any saved model default with it, so that stays
 * delete-and-re-add.
 *
 * `field` is the caller's, because which key holds the URL depends on the
 * client kind: `ollama` and `lmstudio` are read from `endpoint`, everything
 * else from `baseUrl`. Writing the wrong one looks saved and changes nothing.
 *
 * Throws when the entry has no user-layer record, which is the
 * externally-managed case: its connection comes from a default or enforced
 * layer, and copying it into the user's file would detach it from policy.
 */
export async function saveCustomProviderUrl(
	name: string,
	url: string,
	field: 'baseUrl' | 'endpoint',
	options?: ProviderCatalogOptions
): Promise<void> {
	const opts = effectiveOptions(options);
	const { mutateProvidersConfig } = await import('ai-config/node');
	await mutateProvidersConfig(
		(current: ProvidersConfig): ProvidersConfig => {
			const custom = current.providers?.custom;
			const existing = custom?.[name];
			if (!existing) {
				throw new Error(`No custom provider named "${name}" in providers.json.`);
			}
			return {
				...current,
				providers: { ...current.providers, custom: { ...custom, [name]: { ...existing, [field]: url } } },
			};
		},
		{ configPath: opts.configPath, logger: writeLogger }
	);
	await refreshProviderCatalog(opts);
}
