/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { isBuiltinProviderId, mintCustomProviderId, type BuiltinProviderBlock, type ClientKind, type CustomProviderEntry, type LegacySettingsReader, type Protocol, type ProvidersConfig, type ResolvedConnection, type ResolvedProvider, type SupportedCustomClientKind } from 'ai-config';
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
	 * Which client the provider instantiates: a built-in's comes from ai-config's
	 * registry, a custom entry's from its authored `type`. Carried here so an
	 * entry can be presented by its kind without re-reading the file.
	 */
	readonly clientKind: ClientKind;
	readonly enabled: boolean;
	readonly connection: ResolvedConnection;
}

/**
 * Payload of {@link onDidChangeProviderCatalog}. The first two fields name the
 * part of a provider that changed in the *resolved* catalog, which is what the
 * credential chain acts on; the third reports the same providers as the *user
 * file* declares them, for UI that mirrors the file.
 *
 * An id that has just appeared counts as a connection change, from nothing to
 * something, which is how a new custom provider surfaces.
 */
export interface ProviderCatalogChangeEvent {
	/** Ids whose resolved `connection` JSON differs. */
	readonly changedConnectionIds: string[];
	/** Ids whose resolved `enabled` flipped to false. */
	readonly disabledIds: string[];
	/**
	 * Ids whose providers.json block differs. Reported separately because the
	 * resolved and file views move independently: with an environment variable
	 * outranking the file, saving a change leaves `changedConnectionIds` empty
	 * while this is non-empty. Covers the whole block, not just connection
	 * fields, so an `enabled` edit in the file lands here too.
	 */
	readonly changedUserProviderIds: string[];
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
let userConfig = new Map<string, BuiltinProviderBlock>();
let watcher: { dispose(): void } | undefined;
let currentOptions: ProviderCatalogOptions | undefined;
/** Serializes the watch handler's async applies so they land in arrival order. */
let applyQueue: Promise<void> = Promise.resolve();

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
function applyCatalog(next: readonly ResolvedProvider[], changedUserProviderIds: string[] = []): void {
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

	if (
		changedConnectionIds.length === 0
		&& disabledIds.length === 0
		&& changedUserProviderIds.length === 0
		&& !removed
	) {
		return;
	}
	changeEmitter.fire({ changedConnectionIds, disabledIds, changedUserProviderIds });
}

/**
 * Replaces the user-layer cache, returning the ids whose block changed. Kept
 * separate from {@link applyCatalog} so the file view is already current when
 * the event fires and a listener reads it back.
 */
function applyUserConfig(next: Map<string, BuiltinProviderBlock>): string[] {
	const previous = userConfig;
	userConfig = next;

	const changed: string[] = [];
	for (const id of new Set([...previous.keys(), ...next.keys()])) {
		if (JSON.stringify(previous.get(id)) !== JSON.stringify(next.get(id))) {
			changed.push(id);
		}
	}
	return changed;
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
 * Loads the `user` layer -- providers.json alone, with no environment,
 * enforced, or default layer merged in -- into {@link userConfig}.
 *
 * A configuration form has to show what the user durably controls, not the
 * collated result: an `AWS_REGION` picked up from a shell profile is not
 * something the next launch is guaranteed to see, so presenting it as a saved
 * setting would promise persistence the value doesn't have.
 *
 * `loadConfigSources` is ai-config's "source-assembly compatibility seam" and
 * the only public read that returns layers separately -- `loadProviderCatalog-
 * Report`, the canonical read, returns just the resolved catalog and its
 * issues. The seam flattens per-layer issues into logger warnings, so an
 * unreadable file arrives here as an absent user source, indistinguishable
 * from an empty one. If that distinction ever matters, the supported fix is an
 * ai-config change exposing `loadConfigSourceReports`.
 */
async function loadUserConfig(options: ProviderCatalogOptions): Promise<Map<string, BuiltinProviderBlock>> {
	const { loadConfigSources } = await import('ai-config/node');
	const sources = await loadConfigSources({
		configPath: options.configPath,
		env: options.envVars,
		logger: { debug: (m: string) => log.debug(m), warn: (m: string) => log.warn(m) },
	});
	const user = sources.find(source => source.kind === 'user');
	const providers = new Map<string, BuiltinProviderBlock>();
	for (const [id, block] of Object.entries(user?.config.providers ?? {})) {
		// `default` (the baseline block) and `custom` (a nested map of custom
		// entries) are siblings of the built-in ids in this map, not ids
		// themselves -- see ai-config's providersMapSchema. Skipped so they
		// can't be mistaken for providers; a custom provider's own block lives
		// under `custom` and is not exposed here.
		if (block && id !== 'default' && id !== 'custom') {
			providers.set(id, block as BuiltinProviderBlock);
		}
	}
	return providers;
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
	userConfig = await loadUserConfig(options);

	watcher = watchResolvedProviderCatalog(
		// Serialized: the handler has to read the user layer before applying,
		// and watchResolvedProviderCatalog invokes it fire-and-forget, so two
		// rebuilds in quick succession could otherwise have their reads resolve
		// out of order and apply the older catalog last -- leaving both caches
		// stale until the next file change.
		(change: ProviderCatalogChange) => {
			applyQueue = applyQueue
				.then(async () => applyCatalog(change.catalog, applyUserConfig(await loadUserConfig(options))))
				.catch(err => log.warn(`Could not apply a provider catalog change: ${err}`));
		},
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

/** Synchronous read over the cached catalog; undefined before init. */
export function getCachedProvider(catalogId: string): ResolvedProviderLike | undefined {
	return cache.get(catalogId);
}

/**
 * Synchronous read of a *built-in* provider's block as providers.json alone
 * declares it, for UI that must show only what the user set. Use
 * {@link getCachedProvider} for anything that needs the value in effect.
 * Custom providers are not covered: their entries live under
 * `providers.custom`, which this view deliberately omits.
 */
export function getUserProviderBlock(catalogId: string): BuiltinProviderBlock | undefined {
	return userConfig.get(catalogId);
}

/**
 * Reads connection environment variables through the same seam the catalog
 * uses, so a test that passes `envVars` to {@link initProviderCatalog} sees
 * those values here too and never the real shell.
 *
 * Env vars are how a *shadowed* form field is detected. ai-config ranks its
 * internal `env` layer above `user`, so a variable that is set makes the
 * corresponding providers.json value inert -- and detection has to be by
 * *presence*, not by diffing resolved against user: when both layers hold the
 * same value a diff is empty, the input would stay editable, and the next save
 * would be silently discarded.
 *
 * `names` is consulted in order, first set wins, matching ai-config's
 * `readEnv`.
 */
export function readConnectionEnv(names: readonly string[]): string | undefined {
	const env = currentOptions?.envVars ?? process.env;
	for (const name of names) {
		const value = env[name];
		if (value) {
			return value;
		}
	}
	return undefined;
}

/** An env var name, or names consulted in order so the first set one wins. */
type EnvNames = readonly string[];

/**
 * Where one connection value came from, when it did not come from the layer the
 * user controls.
 *
 * Named after ai-config's `ResolvedConnectionValueProvenance`, but carrying the
 * value and the variable that supplied it rather than a bare
 * `'configuration' | 'environment'` kind: a form has to be able to say which
 * variable to change, which a kind alone cannot express.
 */
export interface ConnectionValueProvenance {
	/** The value in effect. */
	readonly value: string;
	/** Name of the environment variable that supplied it. */
	readonly name?: string;
}

/**
 * Provenance for the connection values a form renders, held as a tree parallel
 * to the connection rather than as wrapped values.
 *
 * Mirrors ai-config's `ResolvedConnectionProvenance`, including its reason for
 * staying a separate tree: a `ResolvedConnection` is spread into a provider
 * client's runtime options, so metadata must never live inside it. Only fields
 * something can actually take over appear.
 */
export interface ConnectionProvenance {
	baseUrl?: ConnectionValueProvenance;
	apiKey?: ConnectionValueProvenance;
	aws?: {
		profile?: ConnectionValueProvenance;
		region?: ConnectionValueProvenance;
	};
}

/**
 * Environment variables that take a connection value over, shaped like the
 * provenance they produce: one entry per catalog id, then the field names a
 * form renders, then the variables that supply them.
 *
 * This is the only faithful view of ai-config's `env` layer. That layer is
 * synthesized privately inside `resolveProviderCatalogReport` and is absent
 * from `loadConfigSources`, which returns only `user`, `enforced`, and
 * `default` -- so the table is not enumeration overhead, it is the reader.
 * Mirrors the subset of ai-config's private `CONNECTION_ENV_MAPPINGS` whose
 * fields the modal renders as inputs, keeping that table's nesting so the two
 * can be compared by eye.
 *
 * Only Bedrock is populated today; the other providers' variables
 * (`ANTHROPIC_BASE_URL`, `DATABRICKS_HOST`, `SNOWFLAKE_ACCOUNT`, ...) shadow
 * their inputs the same way, and enabling one is a line of data. Note the keys
 * name the *form field*, not the config path: Databricks and Snowflake carry
 * their value through the base URL input while persisting elsewhere, so
 * `DATABRICKS_HOST` belongs under `baseUrl`.
 *
 * Duplicating a private table risks drift, so `providerSources.test.ts` asserts
 * behaviorally that each variable named here really does reach the resolved
 * catalog, which fails loudly if ai-config renames one or adds an alias.
 */
const OVERRIDING_ENV_VARS: Record<string, {
	baseUrl?: EnvNames;
	apiKey?: EnvNames;
	aws?: { profile?: EnvNames; region?: EnvNames };
}> = {
	bedrock: {
		aws: { profile: ['AWS_PROFILE'], region: ['AWS_REGION'] },
	},
};

/**
 * Resolves one field's variables to its provenance, or undefined when none is
 * set. The reported name is the one that actually supplied the value, so a
 * provider with alias variables names the one the user set.
 */
function readProvenance(names: EnvNames | undefined): ConnectionValueProvenance | undefined {
	for (const name of names ?? []) {
		const value = readConnectionEnv([name]);
		if (value !== undefined) {
			return { value, name };
		}
	}
	return undefined;
}

/**
 * Connection values of `catalogId` that the environment supplies, so a form can
 * show what is in effect and name what set it instead of offering an input
 * whose value would be ignored. Undefined when the user controls every field.
 */
export function getConnectionProvenance(catalogId: string | undefined): ConnectionProvenance | undefined {
	const mapping = catalogId ? OVERRIDING_ENV_VARS[catalogId] : undefined;
	if (!mapping) {
		return undefined;
	}

	const baseUrl = readProvenance(mapping.baseUrl);
	const apiKey = readProvenance(mapping.apiKey);
	const profile = readProvenance(mapping.aws?.profile);
	const region = readProvenance(mapping.aws?.region);

	// Spread so a field with nothing set leaves no key behind: a consumer reads
	// presence as "not editable", so a shell of undefined keys would be
	// indistinguishable from real provenance at the type level.
	const provenance: ConnectionProvenance = {
		...(baseUrl ? { baseUrl } : {}),
		...(apiKey ? { apiKey } : {}),
		...(profile || region
			? { aws: { ...(profile ? { profile } : {}), ...(region ? { region } : {}) } }
			: {}),
	};
	return Object.keys(provenance).length > 0 ? provenance : undefined;
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
	// Both loads complete before either cache is touched: applyUserConfig
	// consumes its diff, so a loadCatalog rejection after that point would
	// discard the change ids for good and leave listeners on stale defaults.
	const nextCatalog = await loadCatalog(opts);
	const nextUserConfig = await loadUserConfig(opts);
	applyCatalog(nextCatalog, applyUserConfig(nextUserConfig));
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

/**
 * Assigns a provider's block, or drops the entry when the block has no keys
 * left. An empty block contributes nothing to resolution, so `"bedrock": {}` is
 * just residue -- and it reads as configuration the user didn't write.
 */
function setOrPruneBlock(
	providers: BuiltinBlockMap,
	catalogId: string,
	block: BuiltinProviderBlock
): void {
	if (Object.keys(block).length === 0) {
		delete providers[catalogId];
	} else {
		providers[catalogId] = block;
	}
}

/**
 * Writes providers.bedrock.aws from the profile/region the connect dialog
 * submitted. Both fields are optional, so each one carries three states and
 * they are not interchangeable:
 *
 * - `undefined` -- the field was not submitted, so the saved value is left
 *   alone. The connect dialog always submits both, so this is for callers that
 *   set one field without disturbing the other.
 * - `''` -- the user emptied the box, so the key is removed and the value
 *   falls back to `AWS_PROFILE` / `AWS_REGION` or the ambient AWS defaults.
 * - a value -- written, trimmed.
 *
 * An `aws` block left with no keys is removed rather than written as `{}`, and
 * a `bedrock` entry with nothing left in it is removed too, so clearing both
 * boxes returns providers.json to the state it had before Bedrock was ever
 * configured.
 *
 * The write is unconditional: settings are saved before the credential chain is
 * resolved with them (the chain reads its connection from the catalog, not from
 * the submitted config), and a failed connect leaves them in place. That matches
 * every other connection setting -- base URL, Snowflake account, Databricks host
 * -- so a value that doesn't work is corrected by reopening the dialog.
 */
export async function saveAwsSettings(
	aws: { profile?: string; region?: string },
	options?: ProviderCatalogOptions
): Promise<void> {
	const opts = effectiveOptions(options);
	await mutate(providers => {
		const block = providers['bedrock'] ?? {};
		const next = { ...block.aws };
		for (const field of ['profile', 'region'] as const) {
			const submitted = aws[field];
			if (submitted === undefined) {
				continue;
			}
			const trimmed = submitted.trim();
			if (trimmed) {
				next[field] = trimmed;
			} else {
				delete next[field];
			}
		}
		const updated: BuiltinProviderBlock = { ...block, aws: next };
		if (Object.keys(next).length === 0) {
			// Removed rather than set to undefined: the config is written
			// through a JSONC editor, so the key has to actually go away.
			delete updated.aws;
		}
		setOrPruneBlock(providers, 'bedrock', updated);
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
 * Reads one custom entry as authored in the user's providers.json, with no
 * enforced, default, or environment overlay. Edits read through here, not the
 * resolved catalog, or they would bake an admin's enforced base URL into the
 * user's file and stop tracking policy. Undefined means no user-layer record:
 * the entry is either absent or externally managed.
 */
export async function readCustomProviderEntry(
	name: string,
	options?: ProviderCatalogOptions
): Promise<CustomProviderEntry | undefined> {
	const { readUserCustomProviderEntry } = await import('ai-config/node');
	return readUserCustomProviderEntry(name, { configPath: effectiveOptions(options).configPath });
}

/** What a new custom entry carries besides its type. */
export interface NewCustomProviderConnection {
	/** Where to call. Omitted when the kind's own default is wanted. */
	readonly baseUrl?: string;
	/** Model ids the user declared, for an endpoint with no `/models` listing. */
	readonly modelIds?: readonly string[];
}

/**
 * Capability defaults for a model the user declared by id alone, mirroring the
 * bridge's OpenAI-compatible defaults. Here because the writer owns the schema;
 * the form asks for an id and nothing else.
 */
const DECLARED_MODEL_DEFAULTS = {
	maxContextLength: 128_000,
	supportsTools: true,
	supportsImages: false,
	supportsToolResultImages: false,
	supportsWebSearch: false,
} satisfies Omit<CustomModelEntry, 'id' | 'name'>;

/**
 * Creates `providers.custom.<name>` under the config lock, then refreshes the
 * cache so the entry's provider registers.
 *
 * `mintCustomProviderId` is called for its throw, not its value: it rejects a
 * built-in provider id, a reserved key, and `__proto__`. Inside the lock, so a
 * name can't be taken between the check and the write.
 *
 * `enabled: true` is explicit so a just-added provider is on even under a
 * `providers.default` block that turns everything else off. A name already taken
 * throws rather than merging, which would attach the new key to someone else's
 * endpoint.
 */
export async function createCustomProviderEntry(
	name: string,
	kind: SupportedCustomClientKind,
	connection: NewCustomProviderConnection = {},
	options?: ProviderCatalogOptions
): Promise<void> {
	const opts = effectiveOptions(options);
	const { mutateProvidersConfig } = await import('ai-config/node');
	await mutateProvidersConfig(
		(current: ProvidersConfig): ProvidersConfig => {
			mintCustomProviderId(name);
			const custom = current.providers?.custom;
			if (custom?.[name]) {
				throw new Error(`A custom provider named "${name}" already exists in providers.json.`);
			}
			const declared = (connection.modelIds ?? [])
				.map(id => id.trim())
				.filter(id => id.length > 0)
				.map(id => ({ id, name: id, ...DECLARED_MODEL_DEFAULTS }));
			const entry = {
				type: kind,
				enabled: true,
				...(connection.baseUrl ? { baseUrl: normalizeSavedBaseUrl(kind, connection.baseUrl) } : {}),
				// Declared ids replace discovery, rather than being merged with a
				// listing the endpoint may also publish.
				...(declared.length > 0 ? { models: { discovery: 'off' as const, custom: declared } } : {}),
			} satisfies CustomProviderEntry;
			return {
				...current,
				providers: { ...current.providers, custom: { ...custom, [name]: entry } },
			};
		},
		{ configPath: opts.configPath, logger: writeLogger }
	);
	await refreshProviderCatalog(opts);
}

/**
 * Removes `providers.custom.<name>` under the config lock, then refreshes the
 * cache so the entry's provider unregisters. Drops the whole `custom` block with
 * the last entry, and throws when there is no user-layer record to remove.
 *
 * Clearing the credential is the Delete action's job, so a stray file edit
 * reaching here can't wipe a key.
 */
export async function deleteCustomProviderEntry(
	name: string,
	options?: ProviderCatalogOptions
): Promise<void> {
	const opts = effectiveOptions(options);
	const { mutateProvidersConfig } = await import('ai-config/node');
	await mutateProvidersConfig(
		(current: ProvidersConfig): ProvidersConfig => {
			const custom = current.providers?.custom;
			if (!custom?.[name]) {
				throw new Error(`No custom provider named "${name}" in providers.json.`);
			}
			const { [name]: _deleted, ...remaining } = custom;
			const providers = { ...current.providers };
			if (Object.keys(remaining).length > 0) {
				providers.custom = remaining;
			} else {
				delete providers.custom;
			}
			return { ...current, providers };
		},
		{ configPath: opts.configPath, logger: writeLogger }
	);
	await refreshProviderCatalog(opts);
}

/**
 * Writes the URL onto an existing `providers.custom.<name>` entry under the
 * config lock, then refreshes the cache, leaving everything else the user
 * authored alone. `type` is not writable: changing the kind re-keys the
 * credential with it, so that stays delete-and-re-add.
 *
 * Writes `baseUrl`, the key every offered kind is read from. The local kinds are
 * read from `endpoint`, so this grows a field argument when they are offered
 * (#12747); writing the wrong key looks saved and changes nothing.
 *
 * Throws when there is no user-layer record, the externally-managed case:
 * copying an enforced connection into the user's file would detach it from
 * policy.
 */
export async function saveCustomProviderUrl(
	name: string,
	url: string,
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
				providers: {
					...current.providers,
					custom: {
						...custom,
						[name]: { ...existing, baseUrl: normalizeSavedBaseUrl(getCachedProvider(name)?.clientKind ?? name, url) },
					},
				},
			};
		},
		{ configPath: opts.configPath, logger: writeLogger }
	);
	await refreshProviderCatalog(opts);
}
