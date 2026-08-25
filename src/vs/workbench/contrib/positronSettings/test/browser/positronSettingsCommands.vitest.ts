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
import { getConfiguredSettings, SETTINGS_GET_CONFIGURED_SETTINGS_COMMAND_ID } from '../../browser/positronSettingsCommands.js';

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
			redactedKeys: [],
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

		expect({ settings: result.settings, redactedKeys: result.redactedKeys }).toEqual({
			redactedKeys: [],
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

		expect({ settings: result.settings, redactedKeys: result.redactedKeys }).toEqual({
			redactedKeys: ['some.extension.apiKey'],
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
			redactedKeys: result.redactedKeys,
			settings: result.settings.map(setting => ({
				key: setting.key,
				value: setting.value,
				sources: setting.sources,
			})),
		}).toEqual({
			redactedKeys: ['testSettings.apiKey', 'testSettings.credentials'],
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

	it('reports the deployment facts a caller needs for the honest-limits caveat', () => {
		// This command cannot enumerate a setting the deployment filtered out of
		// every configuration model, so it reports these two facts instead: a
		// caller uses them to hedge on "absent" rather than assert the user never
		// set the key.
		stubServices({}, { remoteAuthority: 'ssh-remote+workbench', isDefault: false });

		expect(getConfiguredSettings(ctx.instantiationService)).toEqual({
			deployment: { remote: true, defaultProfile: false },
			settings: [],
			redactedKeys: [],
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

	it('is registered as an agent-compatible command with a return contract', () => {
		const command = CommandsRegistry.getCommand(SETTINGS_GET_CONFIGURED_SETTINGS_COMMAND_ID);

		expect({
			agentCompatible: command?.metadata?.agentCompatible,
			hasReturns: (command?.metadata?.returns?.length ?? 0) > 0,
		}).toEqual({ agentCompatible: true, hasReturns: true });
	});
});
