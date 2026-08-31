/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { equals } from '../../../../base/common/objects.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationPropertySchema, IConfigurationRegistry, OVERRIDE_PROPERTY_REGEX } from '../../../../platform/configuration/common/configurationRegistry.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { hasExplicitValue, matchesSensitiveKey, PAYLOAD_SENSITIVE_KEYS, REDACTED_VALUE, redactSensitiveProperties } from '../../positronAssistant/common/settingsInspection.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';
import { IUserDataProfileService } from '../../../services/userDataProfile/common/userDataProfile.js';

/** A configuration target that can carry a value the user set. */
export type ConfiguredSettingSource =
	| 'application'
	| 'userLocal'
	| 'userRemote'
	| 'workspace'
	| 'workspaceFolder'
	| 'policy';

/** Why a setting the user set has no effect. */
export type ConfiguredSettingIgnoredReason = 'overridden-by-policy';

/** One setting the user set, and where they set it. */
export interface IConfiguredSetting {
	key: string;

	/**
	 * The effective value after every target resolves, or the redaction
	 * placeholder. For an ignored setting this is deliberately NOT what the user
	 * wrote: that is in `sources`.
	 */
	value: unknown;

	/**
	 * Present, and false, only when the key is not in the configuration
	 * registry. Absent means the key is registered, which is the overwhelmingly
	 * common case: leaving it out of the payload for that case is most of the
	 * per-entry byte savings the compact form exists for.
	 */
	registered?: boolean;

	/** The registry scope's name, when registered. */
	scope?: string;

	/**
	 * First sentence of the registered description, plain text, capped. Carried
	 * by default so a caller glosses keys from the registry rather than from
	 * memory; absent for unregistered keys, descriptionless ones, and when the
	 * caller opted out.
	 */
	description?: string;

	/**
	 * Present only when the registry marks the key deprecated. Carries the
	 * deprecation message (which usually names the replacement), summarized the
	 * same way as `description`.
	 */
	deprecated?: string;

	/**
	 * The targets that actually carry a value, but only when more than one
	 * does. With a single source, this would only repeat `value`, and
	 * `effectiveSource` already names the target, so it is left out.
	 */
	sources?: Partial<Record<ConfiguredSettingSource, unknown>>;

	/**
	 * Which entry in `sources` produced `value`. Absent when no target the user
	 * set participates in resolution, which means the registered default won.
	 */
	effectiveSource?: ConfiguredSettingSource;

	/** Present only when the user set this key somewhere that has no effect. */
	ignored?: { reason: ConfiguredSettingIgnoredReason };

	/**
	 * Present only when more than one workspace folder sets this key and their
	 * values disagree; carries how many folders set it. The entry's
	 * workspaceFolder value is then just one folder's, and the effective value
	 * depends on which folder a file belongs to. A count rather than per-folder
	 * entries, because naming the folders would mean reporting filesystem
	 * paths, which this command exists to avoid.
	 */
	differingFolders?: number;
}

/** What the getConfiguredSettings command returns. */
export interface IConfiguredSettingsResult {
	/**
	 * Deployment facts a caller needs in order to know what this payload cannot
	 * show. See the module-level comment on getConfiguredSettings.
	 */
	deployment: {
		/** True when the window is connected to a remote (SSH, container, Workbench). */
		remote: boolean;
		/** True when the current profile is the default one, or reuses its settings. */
		defaultProfile: boolean;
	};
	settings: IConfiguredSetting[];

	/**
	 * How many entries had something withheld: the whole value replaced by the
	 * redaction placeholder, or credential-shaped properties inside an object
	 * value. Present only when at least one was. A count rather than a key list
	 * on purpose: the keys are enumerable off the entries themselves (the
	 * placeholder appears as, or inside, `value`), and a sibling key list would
	 * go silently inconsistent if a caller's transport ever truncated
	 * `settings` while preserving siblings. Keeping `settings` the only
	 * top-level array also makes it, by construction, the field a
	 * structure-aware truncation will shed from.
	 */
	redactedCount?: number;
}

/**
 * The order core resolves targets in, strongest first. Policy is stamped over
 * the consolidated model, and the rest follow the consolidation order.
 */
const SOURCE_PRECEDENCE: readonly ConfiguredSettingSource[] = [
	'policy',
	'workspaceFolder',
	'workspace',
	'userRemote',
	'userLocal',
	'application',
];

/**
 * The registry scope as a name a model can read. Kept explicit rather than
 * derived from the enum so the payload's vocabulary does not change under an
 * upstream rename.
 * @param scope The registered scope.
 */
function scopeName(scope: ConfigurationScope): string {
	switch (scope) {
		case ConfigurationScope.APPLICATION: return 'application';
		case ConfigurationScope.MACHINE: return 'machine';
		case ConfigurationScope.APPLICATION_MACHINE: return 'application-machine';
		case ConfigurationScope.WINDOW: return 'window';
		case ConfigurationScope.RESOURCE: return 'resource';
		case ConfigurationScope.LANGUAGE_OVERRIDABLE: return 'language-overridable';
		case ConfigurationScope.MACHINE_OVERRIDABLE: return 'machine-overridable';
	}
}

/** Hard cap on a summarized description or deprecation message, in characters. */
const SUMMARY_CHAR_CAP = 120;

/**
 * A registered description (or deprecation message), reduced to something worth
 * a payload byte budget: markdown link syntax and `#setting.id#` references
 * stripped, first sentence only, hard character cap. Returns undefined for
 * empty input so the field can be omitted rather than carried blank.
 * @param text The registered `description` / `markdownDescription` text.
 */
export function summarizeRegisteredText(text: string | undefined): string | undefined {
	if (!text) {
		return undefined;
	}
	const plain = text
		// [label](https://...) -> label
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		// #editor.fontSize# (settings-editor cross-reference) -> editor.fontSize
		.replace(/#([^#\s]+)#/g, '$1')
		// `code` -> code
		.replace(/`([^`]*)`/g, '$1')
		.replace(/\s+/g, ' ')
		.trim();
	if (!plain) {
		return undefined;
	}
	// First sentence. The lookbehind keeps "e.g." and "i.e." from counting as a
	// sentence end; anything subtler than that is not worth chasing here.
	const sentence = plain.match(/^.*?(?<!\b[ei]\.[ge])[.!?](?=\s|$)/)?.[0] ?? plain;
	if (sentence.length <= SUMMARY_CHAR_CAP) {
		return sentence;
	}
	return `${sentence.slice(0, SUMMARY_CHAR_CAP - 3).trimEnd()}...`;
}

/**
 * The registry's deprecation verdict for a schema, as a payload field: the
 * summarized message when there is one, a plain marker when the registry marks
 * the key deprecated with an empty message (upstream uses that to retire a
 * setting without commentary), and undefined when the key is not deprecated.
 * @param schema The key's registered schema, when registered.
 */
function deprecationSummary(schema: IConfigurationPropertySchema | undefined): string | undefined {
	const message = schema?.deprecationMessage ?? schema?.markdownDeprecationMessage;
	return message !== undefined
		? (summarizeRegisteredText(message) ?? 'deprecated')
		: undefined;
}

/**
 * Reports the settings the user has explicitly set, with per-target provenance
 * and a reason when an entry has no effect.
 *
 * Runs in the renderer on purpose. The extension host folds an enforced value
 * into `defaultValue`, so it structurally cannot see policy, and it has no
 * access to the configuration registry.
 *
 * This reports only what core's configuration model still carries after its
 * own scope filter runs. A key the user genuinely set can be entirely absent
 * from that model (and therefore from this payload) when the deployment
 * filtered it out: on a remote connection, a machine-scoped key set in local
 * user settings; or, on a non-default profile, an application-scoped key.
 * `deployment.remote` and `deployment.defaultProfile` are exactly the facts a
 * caller needs to know that "absent" can mean "filtered out" as well as
 * "never set". There is no accessor here for the filtered-out keys
 * themselves, so this command cannot enumerate or explain them; a caller must
 * hedge instead. See references/configuration.md for how to phrase that.
 * @param accessor The command's services accessor.
 * @param filter Optional case-insensitive substring over the key; the
 * unfiltered call remains the answer to "which settings do I have set".
 * @param includeDescriptions Pass false to omit the per-entry `description`
 * summaries, an opt-out for a pathologically large configuration.
 */
export function getConfiguredSettings(accessor: ServicesAccessor, filter?: string, includeDescriptions?: boolean): IConfiguredSettingsResult {
	const configurationService = accessor.get(IConfigurationService);
	const environmentService = accessor.get(IWorkbenchEnvironmentService);
	const userDataProfileService = accessor.get(IUserDataProfileService);

	const remote = !!environmentService.remoteAuthority;
	const profile = userDataProfileService.currentProfile;
	// The same test getLocalUserConfigurationScopes makes: a profile that reuses
	// the default settings behaves like the default one for scope filtering.
	const defaultProfile = !!(profile.isDefault || profile.useDefaultFlags?.settings);

	const registry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
	const properties = registry.getConfigurationProperties();
	// A key found only among the excluded properties is still one Positron knows
	// about, not a typo. Same fallback ConfigurationModelParser.shouldInclude makes.
	const excluded = registry.getExcludedConfigurationProperties();

	const data = configurationService.getConfigurationData();
	const configuredKeys = configurationService.keys();

	// keys().workspaceFolder is always empty: Configuration.keys() asks for the
	// folder model with an undefined resource, and
	// getFolderConfigurationModelForResource returns undefined unless it gets both
	// a workspace and a resource. Read the folder models straight out of
	// getConfigurationData(), and remember which folder each key came from, because
	// inspect() hits the same guard and needs that resource to report a
	// workspaceFolderValue at all.
	const folderResources = new Map<string, URI>();
	const allFolderResources = new Map<string, URI[]>();
	for (const [folder, folderModel] of data?.folders ?? []) {
		const resource = URI.revive(folder);
		for (const key of folderModel.keys) {
			// First folder to set a key wins the entry. The payload reports one
			// setting per key, not one per folder: naming which folder a value
			// came from would mean reporting a filesystem path, which this
			// command exists to avoid. Every folder is still remembered, so a
			// key whose folders disagree can carry `differingFolders` instead of
			// silently presenting one folder's value as the answer.
			if (!folderResources.has(key)) {
				folderResources.set(key, resource);
			}
			allFolderResources.set(key, [...(allFolderResources.get(key) ?? []), resource]);
		}
	}

	const candidates = new Set<string>([
		...configuredKeys.user,
		...configuredKeys.workspace,
		...folderResources.keys(),
		// IConfigurationService.keys() has no application bucket: applicationConfiguration
		// is a separate model from localUserConfiguration, and Configuration.keys() never
		// reads it. Without this, an APPLICATION-scoped key set only in the default
		// profile's settings.json is invisible to this loop on a non-default profile.
		...(data?.application?.keys ?? []),
	]);

	const settings: IConfiguredSetting[] = [];
	let redactedCount = 0;

	// Guard the arg types: this command's callers include a model.
	const keyFilter = typeof filter === 'string' ? filter.trim().toLowerCase() : '';
	const withDescriptions = includeDescriptions !== false;

	/** Folder-aware inspect(), so a folder-scoped key resolves against the folder that set it. */
	const inspectKey = (key: string) => {
		const folder = folderResources.get(key);
		return folder
			? configurationService.inspect(key, { resource: folder })
			: configurationService.inspect(key);
	};

	for (const key of [...candidates].sort()) {
		if (keyFilter && !key.toLowerCase().includes(keyFilter)) {
			continue;
		}
		const inspected = inspectKey(key);
		if (!hasExplicitValue(inspected)) {
			continue;
		}

		const sources: Partial<Record<ConfiguredSettingSource, unknown>> = {};
		const addSource = (source: ConfiguredSettingSource, value: unknown) => {
			sources[source] = value;
		};

		if (inspected.applicationValue !== undefined) { addSource('application', inspected.applicationValue); }
		if (inspected.userLocalValue !== undefined) { addSource('userLocal', inspected.userLocalValue); }
		if (inspected.userRemoteValue !== undefined) { addSource('userRemote', inspected.userRemoteValue); }
		if (inspected.workspaceValue !== undefined) { addSource('workspace', inspected.workspaceValue); }
		if (inspected.workspaceFolderValue !== undefined) { addSource('workspaceFolder', inspected.workspaceFolderValue); }
		if (inspected.policyValue !== undefined) { addSource('policy', inspected.policyValue); }

		const effective = new Set<ConfiguredSettingSource>(Object.keys(sources) as ConfiguredSettingSource[]);
		const effectiveSource = SOURCE_PRECEDENCE.find(source => effective.has(source));

		// In a multi-root workspace, folders can set the same key to different
		// values, and this payload's single workspaceFolder slot carries only
		// the first folder's. When they actually disagree, say so with a count,
		// so a caller hedges instead of presenting one folder's value as the
		// answer. Identical values across folders collapse silently: nothing is
		// lost by reporting one of them.
		const keyFolders = allFolderResources.get(key);
		let differingFolders: number | undefined;
		if (keyFolders !== undefined && keyFolders.length > 1) {
			const folderValues = keyFolders.map(uri => configurationService.inspect(key, { resource: uri }).workspaceFolderValue);
			if (folderValues.some(folderValue => !equals(folderValue, folderValues[0]))) {
				differingFolders = keyFolders.length;
			}
		}

		// A language-override block, e.g. "[python]": { "editor.tabSize": 4 }. Its key
		// is real (ConfigurationModelParser keeps it in the model's keys) but it is
		// never in getConfigurationProperties() or getExcludedConfigurationProperties(),
		// so without this check it reports as an unregistered typo, and the skill
		// tells the model an unregistered key is very likely a user typo. It is
		// registered in every sense that matters here, at LANGUAGE_OVERRIDABLE scope.
		const isLanguageOverride = OVERRIDE_PROPERTY_REGEX.test(key);
		const schema = properties[key] ?? excluded[key];
		const registered = schema !== undefined || isLanguageOverride;
		const scope = isLanguageOverride
			? ConfigurationScope.LANGUAGE_OVERRIDABLE
			: (schema ? (schema.scope ?? ConfigurationScope.WINDOW) : undefined);

		// Only call it overridden when something of the user's is actually being
		// ignored. A policy-only setting has nothing to explain, so it never becomes
		// a candidate in the first place (the candidate set is not seeded from
		// keys.policy); reaching this branch already means the user set the key
		// somewhere themselves.
		const ignored: IConfiguredSetting['ignored'] = effective.has('policy') && effective.size > 1
			? { reason: 'overridden-by-policy' }
			: undefined;

		// A key the user typed into their own settings file is not more sensitive
		// for being unregistered, and its value is frequently the very thing that
		// identifies what it is (assistant.experimentalFeatures, a real setting
		// from an extension not installed in this window, is exactly this case).
		// Sensitive-key redaction still applies independently, so an unregistered
		// something.apiKey stays redacted on its own merits.
		const redact = matchesSensitiveKey(key, PAYLOAD_SENSITIVE_KEYS);

		// inspected.value is core's fully resolved value. For a language-override
		// key, e.g. "[r]", that resolution deep-merges any shipped
		// configurationDefaults for the block (extensions/positron-r/package.json's
		// "[r]": {...}) with whatever the user set, so it can carry keys that are in
		// NO source at all. Reporting that merged object tells the model the user
		// configured settings they never touched. Build `value` from the winning
		// source instead, so it carries only the user's own contribution.
		const resolvedValue = isLanguageOverride
			? (effectiveSource !== undefined ? sources[effectiveSource] : undefined)
			: inspected.value;

		// Two redaction layers. A credential-shaped (or known credential-bearing)
		// key withholds the whole value. Everything else still gets its object
		// values walked, because the setting's own key can be innocuous while a
		// property inside holds the credential (a token in an env map).
		let entryValue = resolvedValue;
		if (redact) {
			redactedCount++;
			entryValue = REDACTED_VALUE;
			for (const source of Object.keys(sources) as ConfiguredSettingSource[]) {
				sources[source] = REDACTED_VALUE;
			}
		} else {
			let partiallyRedacted = false;
			const walked = redactSensitiveProperties(resolvedValue, PAYLOAD_SENSITIVE_KEYS);
			entryValue = walked.value;
			partiallyRedacted = walked.redacted;
			for (const source of Object.keys(sources) as ConfiguredSettingSource[]) {
				const walkedSource = redactSensitiveProperties(sources[source], PAYLOAD_SENSITIVE_KEYS);
				sources[source] = walkedSource.value;
				partiallyRedacted ||= walkedSource.redacted;
			}
			if (partiallyRedacted) {
				redactedCount++;
			}
		}

		settings.push({
			key,
			value: entryValue,
			// Only carried when false: absence means registered, the common case.
			registered: registered ? undefined : false,
			scope: scope === undefined ? undefined : scopeName(scope),
			description: withDescriptions
				? summarizeRegisteredText(schema?.description ?? schema?.markdownDescription)
				: undefined,
			deprecated: deprecationSummary(schema),
			// Only carried when more than one target has a value; with one, it
			// would only repeat `value`, which `effectiveSource` already names.
			// A redacted single-source entry therefore says nothing beyond the
			// placeholder already in `value`: sources is dropped, not reintroduced
			// with a redacted copy.
			sources: Object.keys(sources).length > 1 ? sources : undefined,
			effectiveSource,
			ignored,
			differingFolders,
		});
	}

	// Most interesting entries first: an agent transport that truncates a large
	// payload keeps an array's *leading* elements, so an overflow should shed
	// unremarkable entries, not the ones that call for a warning. Within each
	// band the key order from the sorted loop above is preserved.
	const interest = (setting: IConfiguredSetting): number =>
		setting.ignored ? 0 : setting.deprecated !== undefined ? 1 : 2;
	settings.sort((a, b) => interest(a) - interest(b));

	return {
		deployment: { remote, defaultProfile },
		settings,
		redactedCount: redactedCount > 0 ? redactedCount : undefined,
	};
}

// The id of the payload command, matching every other agentCompatible command in
// the workbench: one command per payload, carrying its own return contract.
export const SETTINGS_GET_CONFIGURED_SETTINGS_COMMAND_ID = 'positronSettings.getConfiguredSettings';

// Registered through CommandsRegistry rather than registerAction2, so it takes no
// Command Palette slot: the return value is for a programmatic caller, and running
// it from F1 would show the user nothing.
//
// That also means it has no precondition. registerAction2 only records one in
// MenuRegistry when f1 is set, and MenuRegistry is the only place the agent
// discovery path reads preconditions from, so this command always appears in
// getAgentAllowedCommands(). That is what we want: Assistant discovers it once and
// never sees it vanish mid-session. There is no state in which it has nothing to
// say, since there is always a configuration even when the user has set nothing.
//
// Deliberately not gated on the ai.enabled main switch, for the reasons already
// written down at positronPackagesCommands.ts:17-28: it reports the user's own
// environment, it does not call a model or surface an AI action, and Assistant is
// itself gated on ai.enabled. Gating here would only take the payload away from
// non-AI callers.
CommandsRegistry.registerCommand({
	id: SETTINGS_GET_CONFIGURED_SETTINGS_COMMAND_ID,
	handler: getConfiguredSettings,
	metadata: {
		description: localize(
			'positron.settings.getConfiguredSettings.description',
			"Read the settings the user has explicitly configured, with the value each configuration target holds and an explicit reason when a setting they set is having no effect. Changes nothing and shows the user nothing. Names no file path, so it is correct on desktop, on the web, over a remote connection, and on Posit Workbench."
		),
		// Advertise this command to AI agents (positron.ai.getAgentAllowedCommands).
		agentCompatible: true,
		args: [
			{
				name: 'filter',
				description: 'Optional case-insensitive substring to match against setting keys. Omit it to list everything the user has configured.',
				schema: { type: 'string' },
			},
			{
				name: 'includeDescriptions',
				description: 'Pass false to omit the per-entry description summaries. Defaults to true; only worth turning off when a full listing is too large.',
				schema: { type: 'boolean' },
			},
		],
		returns: 'An object describing the settings the user has explicitly set, and only those: defaults the user never touched are not included, and neither is a setting that carries only a policy value the user never set themselves. deployment says whether this window is connected to a remote (SSH, a container, or Posit Workbench) and whether the current profile is the default one; these do not describe a setting directly, but they say what this payload cannot show, since a deployment can filter a setting the user genuinely wrote out of every configuration model before it ever reaches this command. settings is one entry per configured key, ordered most-noteworthy first (entries with ignored, then deprecated ones, then the rest, each sorted by key), with: key; value, the effective value after every target resolves; scope, the setting\'s registry scope when registered; description, the first sentence of the setting\'s registered description, so a caller glosses keys from the registry rather than from memory; and effectiveSource, naming which target won, absent when none of them did and the registered default is in force. deprecated is present only when the registry marks the key deprecated, and carries the deprecation message, which usually names the replacement setting. registered is present, and false, only when the key is not a setting this Positron knows about, which usually means a typo or a setting from an extension that is not installed; its absence means the key is registered. sources, the value in each target that carries one (application, userLocal, userRemote, workspace, workspaceFolder, policy), is present only when more than one target carries a value; with a single source, sources is left out, and effectiveSource alone names the target that holds value. An entry also carries differingFolders, in a multi-root workspace only, when more than one workspace folder sets the key to a different value: the reported workspaceFolder value is then just one folder\'s, the effective value depends on which folder a file belongs to, and differingFolders says how many folders set it -- hedge accordingly rather than presenting one value as the answer. An entry also carries ignored when the user set the key somewhere it has no effect, in which case value is NOT what the user wrote and what they wrote is in sources. The only reason is \'overridden-by-policy\': an administrator, or an account entitlement tied to sign-in state, enforces this setting, and sources.policy holds the value it is pinned to, so the user\'s own entry does nothing. Values that may hold a credential are replaced with \'<redacted>\': the whole value when the key itself is credential-shaped or a known credential-bearing setting (with every entry in that key\'s sources replaced the same way, so a redacted sources entry is never real data), and otherwise the individual properties inside an object value whose names are credential-shaped, e.g. a token in an environment-variable map. redactedCount, present only when at least one entry had something withheld, says how many.',
	},
});

/** One registered setting, as the findSettings command reports it. */
export interface IFoundSetting {
	key: string;

	/**
	 * Present, and false, only for an explicitly requested key the registry
	 * does not know. Absent means registered, same as getConfiguredSettings.
	 */
	registered?: boolean;

	/** First sentence of the registered description, plain text, capped. */
	description?: string;

	/** The registered JSON schema type(s). */
	type?: string | string[];

	/** The registered default. */
	default?: unknown;

	/**
	 * The current effective value, present only when it differs from `default`:
	 * absence reads as "the default is in force". Redacted when the key is
	 * credential-shaped.
	 */
	value?: unknown;

	/** The registry scope's name. */
	scope?: string;

	/** Registry tags, e.g. 'preview' or 'experimental'. */
	tags?: string[];

	/**
	 * Present, and true, only when the setting is excluded from the Settings
	 * editor UI, so the user cannot discover it by browsing there.
	 */
	hidden?: boolean;

	/** Present only when the registry marks the key deprecated. */
	deprecated?: string;

	/** The allowed values, for enum-typed settings. */
	enum?: unknown[];
}

/** What the findSettings command returns. */
export interface IFindSettingsResult {
	/** The matches, best first, at most the requested limit of them. */
	settings: IFoundSetting[];

	/** How many settings matched in total, before the limit was applied. */
	total: number;
}

const FIND_SETTINGS_DEFAULT_LIMIT = 50;
const FIND_SETTINGS_MAX_LIMIT = 100;

/**
 * Searches the configuration *registry*: what settings exist, what each one
 * does, its default, and what it is currently set to. The complement of
 * getConfiguredSettings, which reports only what the user has explicitly set;
 * this one answers questions about settings the user has not touched, and is
 * the only way to enumerate preview/experimental settings, since those are
 * facts of this build's registry, not of any documentation page.
 * @param accessor The command's services accessor.
 * @param query Case-insensitive substring matched against keys and
 * descriptions. Ignored when `keys` is given.
 * @param keys Exact keys to look up, e.g. to enrich a getConfiguredSettings
 * listing. Takes precedence over `query` and the tag filter.
 * @param tag Restrict matches to settings carrying this registry tag.
 * @param limit Maximum number of entries to return.
 */
export function findSettings(accessor: ServicesAccessor, query?: string, keys?: string[], tag?: string, limit?: number): IFindSettingsResult {
	const configurationService = accessor.get(IConfigurationService);

	const registry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
	const properties = registry.getConfigurationProperties();
	// Several Positron preview settings are registered with included: false, so
	// they exist only here. Hidden from the Settings editor is not hidden from
	// this command; it reports them with `hidden` set instead.
	const excluded = registry.getExcludedConfigurationProperties();

	// Guard the arg types: this command's callers include a model.
	const normalizedQuery = typeof query === 'string' ? query.trim().toLowerCase() : '';
	const requestedKeys = Array.isArray(keys) ? keys.filter((key): key is string => typeof key === 'string') : [];
	const normalizedTag = typeof tag === 'string' ? tag.trim().toLowerCase() : '';
	const cap = typeof limit === 'number' && Number.isFinite(limit)
		? Math.min(Math.max(Math.floor(limit), 1), FIND_SETTINGS_MAX_LIMIT)
		: FIND_SETTINGS_DEFAULT_LIMIT;

	const buildEntry = (key: string, schema: IConfigurationPropertySchema): IFoundSetting => {
		const redact = matchesSensitiveKey(key, PAYLOAD_SENSITIVE_KEYS);
		const currentValue = configurationService.getValue(key);
		// `default` is shipped product configuration, never user data, so it is
		// not redacted; only the resolved value can carry something the user put
		// in a settings file. Object values additionally get their properties
		// walked, since an innocuous key can hold a credential-bearing property.
		const differs = !equals(currentValue, schema.default);
		return {
			key,
			description: summarizeRegisteredText(schema.description ?? schema.markdownDescription),
			type: schema.type,
			default: schema.default,
			value: differs
				? (redact ? REDACTED_VALUE : redactSensitiveProperties(currentValue, PAYLOAD_SENSITIVE_KEYS).value)
				: undefined,
			scope: scopeName(schema.scope ?? ConfigurationScope.WINDOW),
			tags: schema.tags?.length ? schema.tags : undefined,
			hidden: properties[key] === undefined && excluded[key] !== undefined ? true : undefined,
			deprecated: deprecationSummary(schema),
			enum: schema.enum?.length ? schema.enum : undefined,
		};
	};

	// Explicit keys: the enrichment path. Deliberately exempt from the query
	// and tag filters -- a caller who names keys wants those keys -- and
	// reported in the caller's own order, minus duplicates.
	if (requestedKeys.length > 0) {
		const uniqueKeys = [...new Set(requestedKeys)];
		const settings = uniqueKeys.slice(0, cap).map(key => {
			const schema = properties[key] ?? excluded[key];
			return schema !== undefined ? buildEntry(key, schema) : { key, registered: false };
		});
		return { settings, total: uniqueKeys.length };
	}

	// Query path. Rank so that a truncated or limited listing keeps the matches
	// the caller most plausibly meant: key equality, then key substring, then
	// description-only matches, alphabetical within each band.
	const matchRank = (key: string, schema: IConfigurationPropertySchema): number | undefined => {
		if (normalizedTag && !schema.tags?.some(candidate => candidate.toLowerCase() === normalizedTag)) {
			return undefined;
		}
		if (!normalizedQuery) {
			return 2;
		}
		const lowerKey = key.toLowerCase();
		if (lowerKey === normalizedQuery) {
			return 0;
		}
		if (lowerKey.includes(normalizedQuery)) {
			return 1;
		}
		const descriptionText = schema.description ?? schema.markdownDescription ?? '';
		return descriptionText.toLowerCase().includes(normalizedQuery) ? 2 : undefined;
	};

	const matches: { key: string; schema: IConfigurationPropertySchema; rank: number }[] = [];
	for (const source of [properties, excluded]) {
		for (const key of Object.keys(source)) {
			// A key present in both maps is reported once, from `properties`.
			if (source === excluded && properties[key] !== undefined) {
				continue;
			}
			const rank = matchRank(key, source[key]);
			if (rank !== undefined) {
				matches.push({ key, schema: source[key], rank });
			}
		}
	}
	matches.sort((a, b) => a.rank - b.rank || a.key.localeCompare(b.key));

	return {
		settings: matches.slice(0, cap).map(match => buildEntry(match.key, match.schema)),
		total: matches.length,
	};
}

// The id of the registry-lookup command. See the registration comment on
// SETTINGS_GET_CONFIGURED_SETTINGS_COMMAND_ID: the same reasoning (plain
// CommandsRegistry registration, no precondition, no ai.enabled gate) applies
// here unchanged.
export const SETTINGS_FIND_SETTINGS_COMMAND_ID = 'positronSettings.findSettings';

CommandsRegistry.registerCommand({
	id: SETTINGS_FIND_SETTINGS_COMMAND_ID,
	handler: findSettings,
	metadata: {
		description: localize(
			'positron.settings.findSettings.description',
			"Search the settings this Positron build registers: what exists, what each setting does, its default, its current value, and whether it is a preview/experimental feature or deprecated. Answers questions about settings whether or not the user has configured them. Changes nothing and shows the user nothing."
		),
		// Advertise this command to AI agents (positron.ai.getAgentAllowedCommands).
		agentCompatible: true,
		args: [
			{
				name: 'query',
				description: 'Case-insensitive substring matched against setting keys and descriptions. Omit to match everything, e.g. when filtering by tag alone.',
				schema: { type: 'string' },
			},
			{
				name: 'keys',
				description: 'Exact setting keys to look up. When given, query and tag are ignored and the entries come back in this order.',
				schema: { type: 'array', items: { type: 'string' } },
			},
			{
				name: 'tag',
				description: 'Restrict matches to settings carrying this registry tag. \'preview\' and \'experimental\' are the tags that mark preview features.',
				schema: { type: 'string' },
			},
			{
				name: 'limit',
				description: 'Maximum number of entries to return. Defaults to 50, capped at 100; total always reports how many matched.',
				schema: { type: 'number' },
			},
		],
		returns: 'An object with settings, the matching registry entries best-match first (key equality, then key substring, then description matches), and total, how many settings matched before the limit was applied: when total exceeds the number of entries returned, say the listing is partial rather than presenting it as complete. Each entry carries: key; description, the first sentence of the registered description; type; default, the registered default value; value, the current effective value, present only when it differs from default, so its absence means the default is in force; scope; tags, e.g. \'preview\' or \'experimental\', which mark preview features; hidden, present and true only when the setting is excluded from the Settings editor UI, so the user cannot find it by browsing there and must edit settings.json directly; deprecated, present only when the registry marks the key deprecated, carrying the deprecation message, which usually names the replacement; and enum, the allowed values for enum-typed settings. For an explicitly requested key the registry does not know, the entry is just key plus registered: false. A value that may hold a credential is replaced with \'<redacted>\', in whole for a credential-shaped or known credential-bearing key, or for the credential-shaped properties inside an object value.',
	},
});
