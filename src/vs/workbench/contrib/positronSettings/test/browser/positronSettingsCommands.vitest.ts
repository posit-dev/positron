/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationData, IConfigurationModel, IConfigurationOverrides, IConfigurationService, IConfigurationValue } from '../../../../../platform/configuration/common/configuration.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationNode, IConfigurationRegistry } from '../../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { IUserDataProfile } from '../../../../../platform/userDataProfile/common/userDataProfile.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IWorkbenchEnvironmentService } from '../../../../services/environment/common/environmentService.js';
import { IUserDataProfileService } from '../../../../services/userDataProfile/common/userDataProfile.js';
import { findSettings, getConfiguredSettings, SETTINGS_FIND_SETTINGS_COMMAND_ID, SETTINGS_GET_CONFIGURED_SETTINGS_COMMAND_ID, summarizeRegisteredText } from '../../browser/positronSettingsCommands.js';

/** Settings registered for these tests, so `registered` and `scope` are real. */
const TEST_CONFIGURATION: IConfigurationNode = {
	id: 'positronSettingsCommandsTest',
	type: 'object',
	properties: {
		'testSettings.fontSize': { type: 'number', scope: ConfigurationScope.WINDOW },
		'testSettings.defaultInterpreterPath': { type: 'string', scope: ConfigurationScope.MACHINE },
		'testSettings.applicationOnly': { type: 'string', scope: ConfigurationScope.APPLICATION },
		'testSettings.apiKey': { type: 'string', scope: ConfigurationScope.WINDOW },
		'testSettings.credentials': { type: 'object', scope: ConfigurationScope.WINDOW },
		'testSettings.folderSetting': { type: 'string', scope: ConfigurationScope.RESOURCE },
		// The keys above have no description on purpose: most tests here assert
		// whole entries with toEqual, and a description would repeat in every one.
		// The description/deprecation behavior gets its own keys instead.
		'testSettings.described': {
			type: 'boolean',
			scope: ConfigurationScope.WINDOW,
			description: 'Enable ghost text suggestions. Requires the notebook AI switch to also be on.',
		},
		'testSettings.markdownDescribed': {
			type: 'string',
			scope: ConfigurationScope.WINDOW,
			markdownDescription: 'Controls the [ghost text](https://example.com/docs) style used when `#testSettings.described#` is on.',
		},
		'testSettings.legacyEnable': {
			type: 'boolean',
			scope: ConfigurationScope.WINDOW,
			deprecationMessage: 'Use testSettings.described instead.',
		},
		'testSettings.silentlyRetired': {
			type: 'boolean',
			scope: ConfigurationScope.WINDOW,
			markdownDeprecationMessage: '',
		},
		// Keys for the findSettings registry-lookup tests.
		'testSettings.previewFeature': {
			type: 'boolean',
			scope: ConfigurationScope.WINDOW,
			default: false,
			tags: ['preview'],
			description: 'Enable the preview canvas. Subject to change.',
		},
		'testSettings.hiddenSetting': {
			type: 'string',
			scope: ConfigurationScope.WINDOW,
			default: 'plain',
			included: false,
			tags: ['experimental'],
			description: 'Not shown in the Settings editor.',
		},
		'testSettings.choice': {
			type: 'string',
			scope: ConfigurationScope.WINDOW,
			default: 'auto',
			enum: ['auto', 'always', 'never'],
		},
		'testSettings.envMap': {
			type: 'object',
			scope: ConfigurationScope.WINDOW,
			default: {},
		},
	},
};

/** What each configuration target holds, as a test declares it. */
interface ITargetValues {
	application?: Record<string, unknown>;
	userLocal?: Record<string, unknown>;
	userRemote?: Record<string, unknown>;
	workspace?: Record<string, unknown>;
	folders?: [URI, Record<string, unknown>][];
	policy?: Record<string, unknown>;
	/**
	 * Shipped configurationDefaults for a language-override key, e.g. an
	 * extension's package.json declaring "[r]": { "editor.tabSize": 2 }. Folded
	 * only into the top-level resolved `value` this fake returns, exactly as core
	 * deep-merges a configurationDefaults block into an override key's resolved
	 * value but never into any single source's own *Value. Without this, the fake
	 * cannot reproduce the bug the collector guards against: its `value` would
	 * already equal whichever source won, same as the fix, and a test against it
	 * would pass whether or not the fix was applied.
	 */
	overrideDefaults?: Record<string, Record<string, unknown>>;
}

function model(values: Record<string, unknown>): IConfigurationModel {
	// `contents` is the values tree, which the collector never reads.
	return { contents: {}, keys: Object.keys(values), overrides: [] };
}

/**
 * A configuration service whose targets can disagree, which is the whole point
 * of the payload under test. Resolves `value` with core's precedence: policy
 * over folder over workspace over remote user over local user over application.
 */
function createConfigurationService(targets: ITargetValues): IConfigurationService {
	const {
		application = {}, userLocal = {}, userRemote = {}, workspace = {}, folders = [], policy = {},
		overrideDefaults = {},
	} = targets;

	const pick = (bag: Record<string, unknown>, key: string) =>
		Object.hasOwn(bag, key) ? bag[key] : undefined;

	function inspectKey(key: string, overrides?: IConfigurationOverrides): IConfigurationValue<unknown> {
		// Mirrors the guard in Configuration.inspect: no resource, no folder value.
		const folderValues = overrides?.resource
			? folders.find(([uri]) => uri.toString() === overrides.resource!.toString())?.[1]
			: undefined;
		const applicationValue = pick(application, key);
		const userLocalValue = pick(userLocal, key);
		const userRemoteValue = pick(userRemote, key);
		const workspaceValue = pick(workspace, key);
		const workspaceFolderValue = folderValues ? pick(folderValues, key) : undefined;
		const policyValue = pick(policy, key);
		const resolvedValue = [policyValue, workspaceFolderValue, workspaceValue, userRemoteValue, userLocalValue, applicationValue]
			.find(candidate => candidate !== undefined);
		// Mirrors core deep-merging a configurationDefaults block into an override
		// key's resolved value: the shipped default's keys show up in `value` even
		// though they are in no source at all. Applied only to `value`, never to
		// any of the per-target *Value fields below, matching production.
		const shippedDefault = overrideDefaults[key];
		const value = shippedDefault
			? { ...shippedDefault, ...(resolvedValue as Record<string, unknown> | undefined) }
			: resolvedValue;
		return {
			value,
			applicationValue,
			userValue: userRemoteValue !== undefined ? userRemoteValue : userLocalValue,
			userLocalValue,
			userRemoteValue,
			workspaceValue,
			workspaceFolderValue,
			policyValue,
		};
	}

	const data: IConfigurationData = {
		defaults: model({}),
		policy: model(policy),
		application: model(application),
		userLocal: model(userLocal),
		userRemote: model(userRemote),
		workspace: model(workspace),
		folders: folders.map(([uri, values]) => [uri.toJSON(), model(values)]),
	};

	return stubInterface<IConfigurationService>({
		inspect: <T>(key: string, overrides?: IConfigurationOverrides) =>
			inspectKey(key, overrides) as IConfigurationValue<T>,
		// Resolves the way production does: an explicit value from any target,
		// falling back to the registered default.
		getValue: ((key: string) => {
			const explicit = inspectKey(key).value;
			if (explicit !== undefined) {
				return explicit;
			}
			const registry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
			return (registry.getConfigurationProperties()[key] ?? registry.getExcludedConfigurationProperties()[key])?.default;
		}) as IConfigurationService['getValue'],
		keys: () => ({
			default: [],
			policy: Object.keys(policy),
			// The merged local-plus-remote model, as core reports it.
			user: [...new Set([...Object.keys(userLocal), ...Object.keys(userRemote)])],
			workspace: Object.keys(workspace),
			// Always empty in core: Configuration.keys() asks for the folder model
			// with an undefined resource. Reproduced here so the collector cannot
			// pass the tests by relying on it.
			workspaceFolder: [],
		}),
		getConfigurationData: () => data,
	});
}

describe('getConfiguredSettings', () => {
	const ctx = createTestContainer().build();
	const registry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);

	beforeAll(() => {
		registry.registerConfiguration(TEST_CONFIGURATION);
	});

	afterAll(() => {
		registry.deregisterConfigurations([TEST_CONFIGURATION]);
	});

	/** Wires the three services the command reads. */
	function stubServices(
		targets: ITargetValues,
		deployment: { remoteAuthority?: string; isDefault?: boolean } = {},
	): void {
		const { remoteAuthority, isDefault = true } = deployment;
		ctx.instantiationService.stub(IConfigurationService, createConfigurationService(targets));
		ctx.instantiationService.stub(IWorkbenchEnvironmentService, stubInterface<IWorkbenchEnvironmentService>({
			remoteAuthority,
		}));
		ctx.instantiationService.stub(IUserDataProfileService, stubInterface<IUserDataProfileService>({
			currentProfile: stubInterface<IUserDataProfile>({ isDefault, useDefaultFlags: undefined }),
		}));
	}

	it('reports a key set only in user settings, with nothing ignored', () => {
		stubServices({ userLocal: { 'testSettings.fontSize': 14 } });

		expect(getConfiguredSettings(ctx.instantiationService)).toEqual({
			deployment: { remote: false, defaultProfile: true },
			// No redacted entry, so redactedCount is omitted rather than 0.
			redactedCount: undefined,
			settings: [{
				key: 'testSettings.fontSize',
				value: 14,
				scope: 'window',
				effectiveSource: 'userLocal',
				ignored: undefined,
			}],
		});
	});

	it('marks a key absent from the registry as unregistered, but still reports its value', () => {
		// A typo, a stale key, or a setting from an extension that is not
		// installed in this window, e.g. assistant.experimentalFeatures, a real
		// setting contributed by the separate posit-dev/assistant extension. None
		// of that makes the value more sensitive: it is often the very thing that
		// identifies what the key is, so it is not withheld just for being
		// unregistered.
		stubServices({ userLocal: { 'testSettings.fontSizee': 14 } });

		const result = getConfiguredSettings(ctx.instantiationService);

		expect({ settings: result.settings, redactedCount: result.redactedCount }).toEqual({
			redactedCount: undefined,
			settings: [{
				key: 'testSettings.fontSizee',
				value: 14,
				registered: false,
				scope: undefined,
				effectiveSource: 'userLocal',
				ignored: undefined,
			}],
		});
	});

	it('still redacts an unregistered key whose name is credential-shaped', () => {
		// The two axes are independent: being unregistered no longer redacts on
		// its own, but a credential-shaped name still does, whether or not the
		// key is registered.
		stubServices({ userLocal: { 'some.extension.apiKey': 'sk-secret' } });

		const result = getConfiguredSettings(ctx.instantiationService);

		expect({ settings: result.settings, redactedCount: result.redactedCount }).toEqual({
			redactedCount: 1,
			settings: [{
				key: 'some.extension.apiKey',
				value: '<redacted>',
				registered: false,
				scope: undefined,
				effectiveSource: 'userLocal',
				ignored: undefined,
			}],
		});
	});

	it('reports a language-override block as registered, not an unregistered typo', () => {
		// "[python]": { "editor.tabSize": 4 } is a real key in the configuration
		// model, but it is never in getConfigurationProperties() or
		// getExcludedConfigurationProperties(). Without special handling it would
		// report as an unregistered typo and get redacted.
		stubServices({ userLocal: { '[python]': { 'editor.tabSize': 4 } } });

		expect(getConfiguredSettings(ctx.instantiationService).settings).toEqual([{
			key: '[python]',
			value: { 'editor.tabSize': 4 },
			scope: 'language-overridable',
			effectiveSource: 'userLocal',
			ignored: undefined,
		}]);
	});

	it('excludes a shipped configurationDefaults default from a language-override key\'s value', () => {
		// The real bug: extensions/positron-r/package.json ships "[r]": {
		// "editor.formatOnType": true, "editor.tabSize": 2, ... }. inspect().value
		// deep-merges that shipped default with whatever the user set, so
		// editor.formatOnType shows up in `value` even though it is in NO source.
		// Reporting that merged object told the owner they had configured settings
		// they never touched. `value` must come from the winning source only.
		stubServices({
			userLocal: { '[r]': { 'editor.tabSize': 4 } },
			overrideDefaults: {
				'[r]': { 'editor.formatOnType': true, 'editor.tabSize': 2 },
			},
		});

		expect(getConfiguredSettings(ctx.instantiationService).settings).toEqual([{
			key: '[r]',
			value: { 'editor.tabSize': 4 },
			scope: 'language-overridable',
			effectiveSource: 'userLocal',
			ignored: undefined,
		}]);
	});

	it('merges a language-override block\'s explicit sources per property, higher target winning', () => {
		// Core resolves an override block per property across targets: a
		// user-level [r] tab size and a workspace-level [r] format-on-save are
		// both in effect. Reporting only the winning source's block would drop
		// the user's tab size from the effective value; reporting core's own
		// resolution would drag shipped defaults back in. The merge covers both:
		// every explicit property appears, the workspace wins the conflict, and
		// nothing the user never touched shows up.
		stubServices({
			userLocal: { '[r]': { 'editor.tabSize': 4, 'editor.formatOnSave': false } },
			workspace: { '[r]': { 'editor.formatOnSave': true } },
			overrideDefaults: { '[r]': { 'editor.formatOnType': true } },
		});

		const [setting] = getConfiguredSettings(ctx.instantiationService).settings;

		expect({ value: setting.value, effectiveSource: setting.effectiveSource }).toEqual({
			value: { 'editor.tabSize': 4, 'editor.formatOnSave': true },
			effectiveSource: 'workspace',
		});
	});

	it('merges object-valued override properties recursively, without mutating sources', () => {
		// Core's merge recurses into object values, so a user-level
		// codeActionsOnSave.source.organizeImports and a workspace-level
		// ...source.fixAll are both in effect -- a shallow per-property merge
		// would report only the workspace object. The sources assertion guards
		// the reference trap: merging must not splice the user's nested object
		// in by reference and then grow it with the workspace's keys.
		stubServices({
			userLocal: { '[python]': { 'editor.codeActionsOnSave': { 'source.organizeImports': 'explicit' } } },
			workspace: { '[python]': { 'editor.codeActionsOnSave': { 'source.fixAll': 'explicit' } } },
		});

		const [setting] = getConfiguredSettings(ctx.instantiationService).settings;

		expect({ value: setting.value, sources: setting.sources }).toEqual({
			value: {
				'editor.codeActionsOnSave': {
					'source.organizeImports': 'explicit',
					'source.fixAll': 'explicit',
				},
			},
			sources: {
				userLocal: { 'editor.codeActionsOnSave': { 'source.organizeImports': 'explicit' } },
				workspace: { 'editor.codeActionsOnSave': { 'source.fixAll': 'explicit' } },
			},
		});
	});

	it('reports a policy-enforced key the user also set as overridden, keeping both values', () => {
		// The Posit Workbench case. Without `ignored` the model reports the
		// enforced value as the product default while the user stares at their
		// own overridden entry in settings.json.
		stubServices({
			userLocal: { 'testSettings.fontSize': 14 },
			policy: { 'testSettings.fontSize': 12 },
		});

		expect(getConfiguredSettings(ctx.instantiationService).settings).toEqual([{
			key: 'testSettings.fontSize',
			value: 12,
			scope: 'window',
			sources: { userLocal: 14, policy: 12 },
			effectiveSource: 'policy',
			ignored: { reason: 'overridden-by-policy' },
		}]);
	});

	it('omits a policy-only setting the user never set', () => {
		// Nothing of the user's is being ignored, and nothing of the user's is
		// present at all: the candidate set is not seeded from keys.policy, so a
		// key that carries only a policy value never becomes a candidate. Without
		// this, every policy-covered setting the user never touched would show up
		// in the payload, which is what produced four chat.agentHost.* entries in
		// a real dev build.
		stubServices({ policy: { 'testSettings.fontSize': 12 } });

		expect(getConfiguredSettings(ctx.instantiationService).settings).toEqual([]);
	});

	it('reports every target that carries a value and names the one that won', () => {
		stubServices({
			application: { 'testSettings.fontSize': 10 },
			userLocal: { 'testSettings.fontSize': 12 },
			userRemote: { 'testSettings.fontSize': 13 },
			workspace: { 'testSettings.fontSize': 14 },
		});

		expect(getConfiguredSettings(ctx.instantiationService).settings).toEqual([{
			key: 'testSettings.fontSize',
			value: 14,
			scope: 'window',
			sources: { application: 10, userLocal: 12, userRemote: 13, workspace: 14 },
			effectiveSource: 'workspace',
			ignored: undefined,
		}]);
	});

	it('reports a folder setting, which needs the folder resource to be visible at all', () => {
		// Two traps, one guard. Configuration.keys() computes the folder model with
		// getFolderConfigurationModelForResource(undefined, workspace), whose first
		// line is `if (workspace && resource)`, so keys().workspaceFolder is always
		// empty. inspect(key) with no overrides hits the same guard, so
		// workspaceFolderValue is always undefined unless the resource is passed.
		const folder = URI.file('/workspace/analysis');
		stubServices({
			userLocal: { 'testSettings.folderSetting': 'user' },
			folders: [[folder, { 'testSettings.folderSetting': 'folder' }]],
		});

		expect(getConfiguredSettings(ctx.instantiationService).settings).toEqual([{
			key: 'testSettings.folderSetting',
			value: 'folder',
			scope: 'resource',
			sources: { userLocal: 'user', workspaceFolder: 'folder' },
			effectiveSource: 'workspaceFolder',
			ignored: undefined,
		}]);
	});

	it('redacts credential-shaped keys everywhere they appear, and nothing else', () => {
		// testSettings.credentials proves the payload list is stricter than the
		// report's, which deliberately leaves credentials alone.
		// testSettings.defaultInterpreterPath proves 'pat' did not become a
		// substring match: an interpreter path is what this payload exists to
		// report.
		stubServices({
			userLocal: {
				'testSettings.apiKey': 'sk-secret',
				'testSettings.credentials': { AWS_PROFILE: 'dev' },
				'testSettings.defaultInterpreterPath': '/usr/bin/python3',
			},
			workspace: { 'testSettings.apiKey': 'sk-other' },
		});

		const result = getConfiguredSettings(ctx.instantiationService);

		expect({
			redactedCount: result.redactedCount,
			settings: result.settings.map(setting => ({
				key: setting.key,
				value: setting.value,
				sources: setting.sources,
			})),
		}).toEqual({
			redactedCount: 2,
			settings: [
				{
					key: 'testSettings.apiKey',
					value: '<redacted>',
					// Two sources, so sources is carried -- and, since this entry is
					// redacted, both entries in it must be the placeholder too, never
					// the real value reintroduced.
					sources: { userLocal: '<redacted>', workspace: '<redacted>' },
				},
				{
					key: 'testSettings.credentials',
					value: '<redacted>',
					// One source: sources is left out by the compact-form rule. A
					// redacted single-source entry must say nothing beyond the
					// placeholder already in value, so this omission must hold even
					// though the underlying source value was itself redacted.
					sources: undefined,
				},
				{
					key: 'testSettings.defaultInterpreterPath',
					value: '/usr/bin/python3',
					sources: undefined,
				},
			],
		});
	});

	it('flags a key that multi-root folders set to different values, without naming them', () => {
		// The payload has one workspaceFolder slot per key, carrying the first
		// folder's value. When another folder resolves differently, an agent
		// reading only that slot would present one folder's value as the answer;
		// distinctFolderValues is the non-path-leaking signal to hedge instead.
		stubServices({
			folders: [
				[URI.file('/workspace/analysis'), { 'testSettings.folderSetting': 'first' }],
				[URI.file('/workspace/reports'), { 'testSettings.folderSetting': 'second' }],
			],
		});

		const [setting] = getConfiguredSettings(ctx.instantiationService).settings;

		expect({ value: setting.value, distinctFolderValues: setting.distinctFolderValues }).toEqual({
			value: 'first',
			distinctFolderValues: 2,
		});
	});

	it('flags a key one folder overrides while the others inherit a different value', () => {
		// Variance is about effective resolution, not explicit setters: folder
		// B never sets the key, but files in it resolve to the user value while
		// files in folder A resolve to A's override.
		stubServices({
			userLocal: { 'testSettings.folderSetting': 'base' },
			folders: [
				[URI.file('/workspace/analysis'), { 'testSettings.folderSetting': 'override' }],
				[URI.file('/workspace/reports'), {}],
			],
		});

		const [setting] = getConfiguredSettings(ctx.instantiationService).settings;

		expect(setting.distinctFolderValues).toBe(2);
	});

	it('collapses folders that agree on a value, with nothing flagged', () => {
		// Identical resolution across folders loses nothing by being reported
		// once, so the flag stays out of the payload.
		stubServices({
			folders: [
				[URI.file('/workspace/analysis'), { 'testSettings.folderSetting': 'same' }],
				[URI.file('/workspace/reports'), { 'testSettings.folderSetting': 'same' }],
			],
		});

		const [setting] = getConfiguredSettings(ctx.instantiationService).settings;

		expect({ value: setting.value, distinctFolderValues: setting.distinctFolderValues }).toEqual({
			value: 'same',
			distinctFolderValues: undefined,
		});
	});

	it('redacts a known credential-bearing key whole, and counts it', () => {
		// http.proxy's last segment is not credential-shaped, but its value is a
		// URL that may embed user:password@host inline -- the whole-key entry on
		// the payload list must catch it end to end.
		stubServices({ userLocal: { 'http.proxy': 'http://user:hunter2@proxy.example.com:8080' } });

		const result = getConfiguredSettings(ctx.instantiationService);

		expect({ value: result.settings[0].value, redactedCount: result.redactedCount }).toEqual({
			value: '<redacted>',
			redactedCount: 1,
		});
	});

	it('redacts credential-shaped properties inside an object value, keeping the rest', () => {
		// An env map's own key is innocuous; the credential is a property inside
		// the value. The walk must catch it in `value` and in every `sources`
		// entry, and the entry counts toward redactedCount.
		stubServices({
			userLocal: { 'testSettings.credentialFreeMap': { PATH: '/usr/local/bin', GITHUB_TOKEN: 'ghp-secret' } },
			workspace: { 'testSettings.credentialFreeMap': { GITHUB_TOKEN: 'ghp-other' } },
		});

		const result = getConfiguredSettings(ctx.instantiationService);

		expect({
			value: result.settings[0].value,
			sources: result.settings[0].sources,
			redactedCount: result.redactedCount,
		}).toEqual({
			value: { GITHUB_TOKEN: '<redacted>' },
			sources: {
				userLocal: { PATH: '/usr/local/bin', GITHUB_TOKEN: '<redacted>' },
				workspace: { GITHUB_TOKEN: '<redacted>' },
			},
			redactedCount: 1,
		});
	});

	it('reports the deployment facts a caller needs for the honest-limits caveat', () => {
		// This command cannot enumerate a setting the deployment filtered out of
		// every configuration model, so it reports these two facts instead: a
		// caller uses them to hedge on "absent" rather than assert the user never
		// set the key.
		stubServices({}, { remoteAuthority: 'ssh-remote+workbench', isDefault: false });

		expect(getConfiguredSettings(ctx.instantiationService)).toEqual({
			deployment: { remote: true, defaultProfile: false },
			settings: [],
			redactedCount: undefined,
		});
	});

	it('reports a key set only in application settings, which keys() cannot supply', () => {
		// IConfigurationService.keys() has no application bucket, so a key that
		// exists only in the application model would never become a candidate
		// without reading data.application.keys directly.
		stubServices({ application: { 'testSettings.applicationOnly': 'set' } });

		expect(getConfiguredSettings(ctx.instantiationService).settings).toEqual([{
			key: 'testSettings.applicationOnly',
			value: 'set',
			scope: 'application',
			effectiveSource: 'application',
			ignored: undefined,
		}]);
	});

	it('reports every configured key, with nothing filtered', () => {
		stubServices({
			userLocal: {
				'testSettings.fontSize': 14,
				'testSettings.apiKey': 'sk-secret',
			},
		});

		const result = getConfiguredSettings(ctx.instantiationService);

		expect(result.settings.map(setting => setting.key).sort()).toEqual([
			'testSettings.apiKey',
			'testSettings.fontSize',
		]);
	});

	it('omits sources for a single-source entry', () => {
		stubServices({ userLocal: { 'testSettings.fontSize': 14 } });

		const [setting] = getConfiguredSettings(ctx.instantiationService).settings;

		expect(setting.sources).toBeUndefined();
		expect(setting.effectiveSource).toBe('userLocal');
	});

	it('includes sources for a multi-source entry', () => {
		stubServices({
			userLocal: { 'testSettings.fontSize': 12 },
			workspace: { 'testSettings.fontSize': 14 },
		});

		const [setting] = getConfiguredSettings(ctx.instantiationService).settings;

		expect(setting.sources).toEqual({ userLocal: 12, workspace: 14 });
	});

	it('omits registered for a registered key, and reports registered: false for an unregistered one', () => {
		stubServices({
			userLocal: {
				'testSettings.fontSize': 14,
				'testSettings.typoo': 'value',
			},
		});

		const settings = getConfiguredSettings(ctx.instantiationService).settings;
		const registeredSetting = settings.find(setting => setting.key === 'testSettings.fontSize');
		const unregisteredSetting = settings.find(setting => setting.key === 'testSettings.typoo');

		expect(registeredSetting?.registered).toBeUndefined();
		expect(unregisteredSetting?.registered).toBe(false);
	});

	it('glosses a key from its registered description, first sentence only', () => {
		// The gloss must come from the registry, not from model memory: without
		// the field a model invents plausible-sounding explanations for keys.
		stubServices({ userLocal: { 'testSettings.described': true } });

		const [setting] = getConfiguredSettings(ctx.instantiationService).settings;

		expect(setting.description).toBe('Enable ghost text suggestions.');
	});

	it('strips markdown link syntax and setting references from a description', () => {
		stubServices({ userLocal: { 'testSettings.markdownDescribed': 'subtle' } });

		const [setting] = getConfiguredSettings(ctx.instantiationService).settings;

		expect(setting.description).toBe('Controls the ghost text style used when testSettings.described is on.');
	});

	it('omits descriptions when the caller opts out', () => {
		stubServices({ userLocal: { 'testSettings.described': true } });

		const [setting] = getConfiguredSettings(ctx.instantiationService, undefined, false).settings;

		expect(setting.description).toBeUndefined();
	});

	it('carries the deprecation message, and a plain marker when the registry has none', () => {
		stubServices({
			userLocal: {
				'testSettings.legacyEnable': true,
				'testSettings.silentlyRetired': true,
			},
		});

		const settings = getConfiguredSettings(ctx.instantiationService).settings;

		expect(settings.map(setting => ({ key: setting.key, deprecated: setting.deprecated }))).toEqual([
			{ key: 'testSettings.legacyEnable', deprecated: 'Use testSettings.described instead.' },
			// An empty deprecationMessage still marks the key deprecated; the
			// field must not vanish with the missing message.
			{ key: 'testSettings.silentlyRetired', deprecated: 'deprecated' },
		]);
	});

	it('filters by case-insensitive key substring', () => {
		stubServices({
			userLocal: {
				'testSettings.fontSize': 14,
				'testSettings.described': true,
			},
		});

		const settings = getConfiguredSettings(ctx.instantiationService, 'FONTSIZE').settings;

		expect(settings.map(setting => setting.key)).toEqual(['testSettings.fontSize']);
	});

	it('orders entries by interest: ignored, then deprecated, then the rest', () => {
		// An agent transport that truncates a large payload keeps an array's
		// leading elements, so the entries that call for a warning must come
		// first, ahead of key order.
		stubServices({
			userLocal: {
				'testSettings.applicationOnly': 'set',
				'testSettings.fontSize': 14,
				'testSettings.legacyEnable': true,
			},
			policy: { 'testSettings.fontSize': 12 },
		});

		const settings = getConfiguredSettings(ctx.instantiationService).settings;

		expect(settings.map(setting => setting.key)).toEqual([
			'testSettings.fontSize',
			'testSettings.legacyEnable',
			'testSettings.applicationOnly',
		]);
	});

	it('is registered as an agent-compatible command with a return contract', () => {
		const command = CommandsRegistry.getCommand(SETTINGS_GET_CONFIGURED_SETTINGS_COMMAND_ID);

		expect({
			agentCompatible: command?.metadata?.agentCompatible,
			hasReturns: (command?.metadata?.returns?.length ?? 0) > 0,
			argNames: command?.metadata?.args?.map(arg => arg.name),
		}).toEqual({
			agentCompatible: true,
			hasReturns: true,
			argNames: ['filter', 'includeDescriptions'],
		});
	});
});

describe('findSettings', () => {
	const ctx = createTestContainer().build();
	const registry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);

	beforeAll(() => {
		registry.registerConfiguration(TEST_CONFIGURATION);
	});

	afterAll(() => {
		registry.deregisterConfigurations([TEST_CONFIGURATION]);
	});

	/**
	 * findSettings only reads IConfigurationService, but the query path scans
	 * the whole global registry, so every query below is scoped to the
	 * testSettings namespace to stay independent of what else the test
	 * environment registered.
	 */
	function stubConfiguration(targets: ITargetValues = {}): void {
		ctx.instantiationService.stub(IConfigurationService, createConfigurationService(targets));
	}

	it('reports registry facts for a key-substring query', () => {
		stubConfiguration();

		const result = findSettings(ctx.instantiationService, 'testSettings.previewFeature');

		expect(result).toEqual({
			total: 1,
			settings: [{
				key: 'testSettings.previewFeature',
				description: 'Enable the preview canvas.',
				type: 'boolean',
				default: false,
				scope: 'window',
				tags: ['preview'],
			}],
		});
	});

	it('ranks an exact key match ahead of a description match', () => {
		// 'testSettings.described' is markdownDescribed's description text, so
		// the query hits both: the exact key must come first, ahead of key order.
		stubConfiguration();

		const result = findSettings(ctx.instantiationService, 'testSettings.described');

		expect(result.settings.map(setting => setting.key)).toEqual([
			'testSettings.described',
			'testSettings.markdownDescribed',
		]);
	});

	it('looks up explicit keys in the caller\'s order, marking unknown ones unregistered', () => {
		stubConfiguration();

		const result = findSettings(ctx.instantiationService, undefined, [
			'testSettings.choice',
			'testSettings.noSuchKey',
			'testSettings.previewFeature',
		]);

		expect(result.total).toBe(3);
		expect(result.settings.map(setting => ({ key: setting.key, registered: setting.registered }))).toEqual([
			{ key: 'testSettings.choice', registered: undefined },
			{ key: 'testSettings.noSuchKey', registered: false },
			{ key: 'testSettings.previewFeature', registered: undefined },
		]);
	});

	it('filters by tag, which is how preview features are enumerated', () => {
		stubConfiguration();

		const result = findSettings(ctx.instantiationService, 'testSettings.', undefined, 'preview');

		expect(result.settings.map(setting => setting.key)).toEqual(['testSettings.previewFeature']);
	});

	it('finds a setting hidden from the Settings editor and says so', () => {
		// Several real Positron preview settings are registered with
		// included: false, so they exist only in the excluded map; missing them
		// would make "which features are in preview" silently incomplete.
		stubConfiguration();

		const result = findSettings(ctx.instantiationService, 'testSettings.hiddenSetting');

		expect(result.settings).toEqual([{
			key: 'testSettings.hiddenSetting',
			description: 'Not shown in the Settings editor.',
			type: 'string',
			default: 'plain',
			scope: 'window',
			tags: ['experimental'],
			hidden: true,
		}]);
	});

	it('carries the current value only when it differs from the default', () => {
		stubConfiguration({ userLocal: { 'testSettings.previewFeature': true } });

		const result = findSettings(ctx.instantiationService, undefined, [
			'testSettings.previewFeature',
			'testSettings.choice',
		]);

		expect(result.settings.map(setting => ({ key: setting.key, value: setting.value }))).toEqual([
			// Configured away from its default, so the value is carried.
			{ key: 'testSettings.previewFeature', value: true },
			// At its default: absence of value means the default is in force.
			{ key: 'testSettings.choice', value: undefined },
		]);
	});

	it('carries enum values for enum-typed settings', () => {
		stubConfiguration();

		const [setting] = findSettings(ctx.instantiationService, undefined, ['testSettings.choice']).settings;

		expect(setting.enum).toEqual(['auto', 'always', 'never']);
	});

	it('redacts credential-shaped properties inside an object value', () => {
		// The registered key is innocuous; the credential is a property inside
		// the configured value.
		stubConfiguration({ userLocal: { 'testSettings.envMap': { PATH: '/usr/local/bin', GITHUB_TOKEN: 'ghp-secret' } } });

		const [setting] = findSettings(ctx.instantiationService, undefined, ['testSettings.envMap']).settings;

		expect(setting.value).toEqual({ PATH: '/usr/local/bin', GITHUB_TOKEN: '<redacted>' });
	});

	it('redacts a credential-shaped key\'s value, but never its shipped default', () => {
		stubConfiguration({ userLocal: { 'testSettings.apiKey': 'sk-secret' } });

		const [setting] = findSettings(ctx.instantiationService, undefined, ['testSettings.apiKey']).settings;

		expect({ value: setting.value, default: setting.default }).toEqual({
			value: '<redacted>',
			// The registry fills in a type-derived default ('' for a string) when
			// none is declared. Shipped configuration, not user data, so it is
			// reported as-is rather than redacted.
			default: '',
		});
	});

	it('applies the limit while reporting the full match count', () => {
		stubConfiguration();

		const result = findSettings(ctx.instantiationService, 'testSettings.', undefined, undefined, 2);

		expect(result.settings).toHaveLength(2);
		expect(result.total).toBeGreaterThanOrEqual(9);
	});

	it('is registered as an agent-compatible command with a return contract', () => {
		const command = CommandsRegistry.getCommand(SETTINGS_FIND_SETTINGS_COMMAND_ID);

		expect({
			agentCompatible: command?.metadata?.agentCompatible,
			hasReturns: (command?.metadata?.returns?.length ?? 0) > 0,
			argNames: command?.metadata?.args?.map(arg => arg.name),
		}).toEqual({
			agentCompatible: true,
			hasReturns: true,
			argNames: ['query', 'keys', 'tag', 'limit'],
		});
	});
});

describe('summarizeRegisteredText', () => {
	it('returns undefined for missing or effectively empty text', () => {
		expect(summarizeRegisteredText(undefined)).toBeUndefined();
		expect(summarizeRegisteredText('')).toBeUndefined();
		expect(summarizeRegisteredText('  ``  ')).toBeUndefined();
	});

	it('does not treat "e.g." as a sentence end', () => {
		expect(summarizeRegisteredText('Pick a language, e.g. Python or R, for the session.'))
			.toBe('Pick a language, e.g. Python or R, for the session.');
	});

	it('caps a run-on first sentence with an ellipsis', () => {
		const longText = `${'word '.repeat(40)}end.`;

		const summary = summarizeRegisteredText(longText)!;

		expect(summary.length).toBeLessThanOrEqual(120);
		expect(summary.endsWith('...')).toBe(true);
	});

	it('collapses newlines and runs of whitespace', () => {
		expect(summarizeRegisteredText('Line one\ncontinues   here.')).toBe('Line one continues here.');
	});
});
