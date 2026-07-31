/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { stubInterface } from '../../../../../../../test/vitest/stubInterface.js';
import { IConfigurationChangeEvent } from '../../../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { NotebookSetting } from '../../../../../notebook/common/notebookCommon.js';
import { PositronNotebookFindFilters } from '../../../../browser/contrib/find/findFilters.js';

describe('PositronNotebookFindFilters', () => {
	let configurationService: TestConfigurationService;

	beforeEach(() => {
		configurationService = new TestConfigurationService();
	});

	/** Sets the notebook.find.filters setting and fires the change event. */
	async function setFindFiltersSetting(value: unknown): Promise<void> {
		await configurationService.setUserConfiguration(NotebookSetting.findFilters, value);
		configurationService.onDidChangeConfigurationEmitter.fire(
			stubInterface<IConfigurationChangeEvent>({
				affectsConfiguration: (key: string) => key === NotebookSetting.findFilters,
			})
		);
	}

	it('defaults all filters to enabled when the setting is absent', () => {
		const filters = new PositronNotebookFindFilters(configurationService);

		expect(filters.state.get()).toEqual({
			markupSource: true,
			markupPreview: true,
			codeSource: true,
			codeOutput: true,
		});
		expect(filters.isModified.get()).toBe(false);
	});

	it('reads defaults from the notebook.find.filters setting', async () => {
		await configurationService.setUserConfiguration(NotebookSetting.findFilters, {
			markupSource: true,
			markupPreview: false,
			codeSource: true,
			codeOutput: false,
		});
		const filters = new PositronNotebookFindFilters(configurationService);

		expect(filters.state.get()).toEqual({
			markupSource: true,
			markupPreview: false,
			codeSource: true,
			codeOutput: false,
		});
		// The state matches the setting, so nothing is modified.
		expect(filters.isModified.get()).toBe(false);
	});

	it('fills in missing keys of a partial setting value with enabled', async () => {
		await configurationService.setUserConfiguration(NotebookSetting.findFilters, { codeOutput: false });
		const filters = new PositronNotebookFindFilters(configurationService);

		expect(filters.state.get()).toEqual({
			markupSource: true,
			markupPreview: true,
			codeSource: true,
			codeOutput: false,
		});
	});

	it('reacts to live setting changes', async () => {
		const filters = new PositronNotebookFindFilters(configurationService);
		expect(filters.state.get().codeOutput).toBe(true);

		await setFindFiltersSetting({ codeOutput: false });

		expect(filters.state.get().codeOutput).toBe(false);
	});

	it('setFilter overrides the setting for the session', () => {
		const filters = new PositronNotebookFindFilters(configurationService);

		filters.setFilter('markupPreview', false);

		expect(filters.state.get().markupPreview).toBe(false);
		expect(filters.isModified.get()).toBe(true);
	});

	it('setting changes still apply to filters without a session override', async () => {
		const filters = new PositronNotebookFindFilters(configurationService);
		filters.setFilter('markupPreview', false);

		await setFindFiltersSetting({ codeOutput: false });

		expect(filters.state.get()).toEqual({
			markupSource: true,
			markupPreview: false,
			codeSource: true,
			codeOutput: false,
		});
	});

	it('a session override wins over a later setting change for the same key', async () => {
		const filters = new PositronNotebookFindFilters(configurationService);
		filters.setFilter('codeOutput', false);

		await setFindFiltersSetting({ codeOutput: true });

		expect(filters.state.get().codeOutput).toBe(false);
	});

	it('isModified clears when an override matches the setting again', async () => {
		const filters = new PositronNotebookFindFilters(configurationService);

		filters.setFilter('codeOutput', false);
		expect(filters.isModified.get()).toBe(true);

		// The setting catches up with the override.
		await setFindFiltersSetting({ codeOutput: false });
		expect(filters.isModified.get()).toBe(false);
	});
});
