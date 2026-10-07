/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IConfigurationService, IConfigurationValue } from '../../../../../platform/configuration/common/configuration.js';
import { IPreferencesService } from '../../common/preferences.js';
import { openSettingWhereSet } from '../../common/positronSettingsUtils.js';

describe('openSettingWhereSet', () => {
	const key = 'interpreters.startupBehavior';
	const languageOptions = { query: '@lang:python interpreters.startupBehavior', revealSetting: { key: '[python]' } };
	const allLanguagesOptions = { query: 'interpreters.startupBehavior', revealSetting: { key: 'interpreters.startupBehavior' } };

	async function open(value: IConfigurationValue<string>, languageId?: string, languageSpecific?: boolean) {
		const inspect = vi.fn(() => value as IConfigurationValue<never>);
		const preferencesService = stubInterface<IPreferencesService>({
			openUserSettings: vi.fn(async () => undefined),
			openRemoteSettings: vi.fn(async () => undefined),
			openWorkspaceSettings: vi.fn(async () => undefined),
		});
		await openSettingWhereSet(preferencesService, stubInterface<IConfigurationService>({ inspect }), key, languageId, languageSpecific);
		return {
			inspect: inspect.mock.calls,
			user: vi.mocked(preferencesService.openUserSettings).mock.calls,
			remote: vi.mocked(preferencesService.openRemoteSettings).mock.calls,
			workspace: vi.mocked(preferencesService.openWorkspaceSettings).mock.calls,
		};
	}

	it('opens the User settings tab when the value comes from user settings', async () => {
		expect(await open({ userLocal: { override: 'always' }, value: 'always' }, 'python')).toEqual({
			inspect: [[key, { overrideIdentifier: 'python' }]],
			user: [[languageOptions]],
			remote: [],
			workspace: [],
		});
	});

	it('opens the Remote settings tab when the value comes from remote user settings', async () => {
		expect(await open({ userRemote: { override: 'always' }, value: 'always' }, 'python')).toMatchObject({
			user: [],
			remote: [[languageOptions]],
			workspace: [],
		});
	});

	it('opens the Workspace settings tab when the value comes from workspace settings', async () => {
		expect(await open({ workspace: { override: 'always' }, value: 'always' }, 'python')).toMatchObject({
			user: [],
			remote: [],
			workspace: [[languageOptions]],
		});
	});

	it('opens the tab with the language-specific value over a tab with a value for all languages', async () => {
		// A language-specific user value wins over a workspace value for all languages.
		expect(await open({ workspace: { value: 'auto' }, userLocal: { override: 'always' }, value: 'always' }, 'python')).toMatchObject({
			user: [[languageOptions]],
			remote: [],
			workspace: [],
		});
	});

	it('opens the Workspace settings tab over the User settings tab when both set a language-specific value', async () => {
		expect(await open({ workspace: { override: 'always' }, userLocal: { override: 'manual' }, value: 'always' }, 'python')).toMatchObject({
			user: [],
			remote: [],
			workspace: [[languageOptions]],
		});
	});

	it('opens the Remote settings tab over the User settings tab when both set a language-specific value', async () => {
		expect(await open({ userRemote: { override: 'always' }, userLocal: { override: 'manual' }, value: 'always' }, 'python')).toMatchObject({
			user: [],
			remote: [[languageOptions]],
			workspace: [],
		});
	});

	it('opens the setting for all languages when the value is set for all languages', async () => {
		expect(await open({ userLocal: { value: 'always' }, value: 'always' }, 'python', true)).toMatchObject({
			user: [[allLanguagesOptions]],
			remote: [],
			workspace: [],
		});
	});

	it('opens the User settings tab with the given kind of setting when no tab sets a value', async () => {
		expect((await open({ value: 'auto' }, 'python', true)).user).toEqual([[languageOptions]]);
		expect((await open({ value: 'auto' }, 'python', false)).user).toEqual([[allLanguagesOptions]]);
	});

	it('opens the setting for all languages without a language', async () => {
		expect(await open({ workspace: { value: 'always' }, value: 'always' }, undefined, true)).toEqual({
			inspect: [[key]],
			user: [],
			remote: [],
			workspace: [[allLanguagesOptions]],
		});
	});
});
