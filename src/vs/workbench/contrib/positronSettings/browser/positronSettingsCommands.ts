/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry, OVERRIDE_PROPERTY_REGEX } from '../../../../platform/configuration/common/configurationRegistry.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { hasExplicitValue, matchesSensitiveKey, PAYLOAD_SENSITIVE_KEYS, REDACTED_VALUE } from '../../positronAssistant/common/settingsInspection.js';
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
	/** Keys whose values were withheld, so a caller can say so rather than guess. */
	redactedKeys: string[];
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
 * hedge instead. See references/settings.md for how to phrase that.
 * @param accessor The command's services accessor.
 */
export function getConfiguredSettings(accessor: ServicesAccessor): IConfiguredSettingsResult {
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
	for (const [folder, folderModel] of data?.folders ?? []) {
		const resource = URI.revive(folder);
		for (const key of folderModel.keys) {
			// First folder to set a key wins. The payload reports one setting per
			// key, not one per folder: naming which folder a value came from would
			// mean reporting a filesystem path, which this command exists to avoid.
			if (!folderResources.has(key)) {
				folderResources.set(key, resource);
			}
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
	const redactedKeys: string[] = [];

	/** Folder-aware inspect(), so a folder-scoped key resolves against the folder that set it. */
	const inspectKey = (key: string) => {
		const folder = folderResources.get(key);
		return folder
			? configurationService.inspect(key, { resource: folder })
			: configurationService.inspect(key);
	};

	for (const key of [...candidates].sort()) {
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

		if (redact) {
			redactedKeys.push(key);
			for (const source of Object.keys(sources) as ConfiguredSettingSource[]) {
				sources[source] = REDACTED_VALUE;
			}
		}

		settings.push({
			key,
			value: redact ? REDACTED_VALUE : resolvedValue,
			// Only carried when false: absence means registered, the common case.
			registered: registered ? undefined : false,
			scope: scope === undefined ? undefined : scopeName(scope),
			// Only carried when more than one target has a value; with one, it
			// would only repeat `value`, which `effectiveSource` already names.
			// A redacted single-source entry therefore says nothing beyond the
			// placeholder already in `value`: sources is dropped, not reintroduced
			// with a redacted copy.
			sources: Object.keys(sources).length > 1 ? sources : undefined,
			effectiveSource,
			ignored,
		});
	}

	return { deployment: { remote, defaultProfile }, settings, redactedKeys };
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
		returns: 'An object describing the settings the user has explicitly set, and only those: defaults the user never touched are not included, and neither is a setting that carries only a policy value the user never set themselves. deployment says whether this window is connected to a remote (SSH, a container, or Posit Workbench) and whether the current profile is the default one; these do not describe a setting directly, but they say what this payload cannot show, since a deployment can filter a setting the user genuinely wrote out of every configuration model before it ever reaches this command. settings is one entry per configured key, sorted by key, with: key; value, the effective value after every target resolves; scope, the setting\'s registry scope when registered; and effectiveSource, naming which target won, absent when none of them did and the registered default is in force. registered is present, and false, only when the key is not a setting this Positron knows about, which usually means a typo or a setting from an extension that is not installed; its absence means the key is registered. sources, the value in each target that carries one (application, userLocal, userRemote, workspace, workspaceFolder, policy), is present only when more than one target carries a value; with a single source, sources is left out, and effectiveSource alone names the target that holds value. An entry also carries ignored when the user set the key somewhere it has no effect, in which case value is NOT what the user wrote and what they wrote is in sources. The only reason is \'overridden-by-policy\': an administrator, or an account entitlement tied to sign-in state, enforces this setting, and sources.policy holds the value it is pinned to, so the user\'s own entry does nothing. Values that may hold a credential are replaced with \'<redacted>\', and every entry in that key\'s sources is replaced the same way, so a redacted sources entry is never real data; redactedKeys lists every key that happened to.',
	},
});
