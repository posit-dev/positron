/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter, Event } from '../../../../../base/common/event.js';
import { IInlineCompletionsService } from '../../../../../editor/browser/services/inlineCompletionsService.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IContextKeyChangeEvent, IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IStatusbarEntry, IStatusbarService } from '../../../../services/statusbar/browser/statusbar.js';
import { NES_CONTEXT_AVAILABLE, NES_CONTEXT_BUSY, NES_CONTEXT_FILE_ENABLED, NES_ENABLE_SETTING } from '../../browser/nextEditSuggestionsDashboard.js';
import { NextEditSuggestionsStatusBarEntry } from '../../browser/nextEditSuggestionsStatusBar.js';

describe('NextEditSuggestionsStatusBarEntry', () => {
	let snoozing: boolean;
	let busy: boolean;
	let enabled: boolean;
	let fileEnabled: boolean;
	let languageId: string | undefined;

	const onDidChangeContext = new Emitter<IContextKeyChangeEvent>();
	const onDidChangeIsSnoozing = new Emitter<boolean>();

	const entryAccessor = { update: vi.fn<(entry: IStatusbarEntry) => void>(), dispose: vi.fn() };
	const addEntry = vi.fn<(entry: IStatusbarEntry) => typeof entryAccessor>(() => entryAccessor);

	const config = new TestConfigurationService();

	const ctx = createTestContainer()
		.stub(IInlineCompletionsService, {
			isSnoozing: () => snoozing,
			onDidChangeIsSnoozing: onDidChangeIsSnoozing.event,
		})
		.stub(IContextKeyService, {
			getContextKeyValue: <T>(key: string): T | undefined => {
				const values: Record<string, boolean> = { [NES_CONTEXT_AVAILABLE]: enabled, [NES_CONTEXT_BUSY]: busy, [NES_CONTEXT_FILE_ENABLED]: fileEnabled };
				return values[key] as T | undefined;
			},
			onDidChangeContext: onDidChangeContext.event,
		})
		.stub(IEditorService, {
			get activeTextEditorLanguageId() { return languageId; },
			activeTextEditorControl: undefined,
			onDidActiveEditorChange: Event.None,
		})
		.stub(IConfigurationService, config)
		.stub(IStatusbarService, { addEntry })
		.build();

	beforeEach(() => {
		snoozing = false;
		busy = false;
		enabled = true;
		fileEnabled = true;
		languageId = 'python';
		config.setUserConfiguration(NES_ENABLE_SETTING, { '*': true });
	});

	/** The most recent props pushed to the status bar (the last `entry.update`, else the `addEntry` argument). */
	function lastProps(): IStatusbarEntry {
		const updateCalls = entryAccessor.update.mock.calls;
		if (updateCalls.length > 0) {
			return updateCalls[updateCalls.length - 1][0];
		}
		return addEntry.mock.calls[addEntry.mock.calls.length - 1][0];
	}

	function fireContextChange(): void {
		onDidChangeContext.fire({ affectsSome: () => true, allKeysContainedIn: () => true });
	}

	function createEntry(): NextEditSuggestionsStatusBarEntry {
		return ctx.disposables.add(ctx.instantiationService.createInstance(NextEditSuggestionsStatusBarEntry));
	}

	it.each([
		{ name: 'snoozing', setup: () => { snoozing = true; }, text: '$(skip)', ariaLabel: 'Next edit suggestions snoozed' },
		{ name: 'busy', setup: () => { busy = true; }, text: '$(loading~spin)', ariaLabel: 'Waiting for next edit suggestion' },
		{ name: 'file disabled', setup: () => { fileEnabled = false; }, text: '$(circle-slash)', ariaLabel: 'Next edit suggestions disabled' },
		{ name: 'enabled', setup: () => { }, text: '$(edit-sparkle)', ariaLabel: 'Next Edit Suggestions' },
	])('renders the $name state', ({ setup, text, ariaLabel }) => {
		setup();
		createEntry();
		fireContextChange();

		expect({ text: lastProps().text, ariaLabel: lastProps().ariaLabel }).toEqual({ text, ariaLabel });
	});

	it('prefers snoozing over busy', () => {
		snoozing = true;
		busy = true;
		createEntry();
		fireContextChange();

		expect(lastProps().text).toBe('$(skip)');
	});

	it('prefers busy over file-disabled', () => {
		busy = true;
		fileEnabled = false;
		createEntry();
		fireContextChange();

		expect(lastProps().text).toBe('$(loading~spin)');
	});

	it('adds, disposes, and re-adds the entry as the enabled context key flips', () => {
		enabled = false;
		createEntry();
		expect(addEntry).not.toHaveBeenCalled();

		enabled = true;
		fireContextChange();
		expect(addEntry).toHaveBeenCalledTimes(1);

		enabled = false;
		fireContextChange();
		expect(entryAccessor.dispose).toHaveBeenCalledTimes(1);

		enabled = true;
		fireContextChange();
		expect(addEntry).toHaveBeenCalledTimes(2);
	});
});
