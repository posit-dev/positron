/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Event } from '../../../../../base/common/event.js';
import { IConfigurationChangeEvent } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { INotebookEditorDelegate } from '../../../notebook/browser/notebookBrowser.js';
import { NotebookDisplayOptions, NotebookOptions } from '../../../notebook/browser/notebookOptions.js';
import { BaseCellEditorOptions } from '../../browser/BaseCellEditorOptions.js';
import { POSITRON_NOTEBOOK_FOLDING_KEY } from '../../common/positronNotebookConfig.js';

describe('BaseCellEditorOptions', () => {
	const store = new DisposableStore();

	afterEach(() => {
		store.clear();
	});

	function createOptions(config: Record<string, unknown> = {}) {
		const configurationService = new TestConfigurationService({ editor: {}, ...config });
		const notebookOptions = stubInterface<NotebookOptions>({
			onDidChangeOptions: Event.None,
			getDisplayOptions: () => stubInterface<NotebookDisplayOptions>({ editorOptionsCustomizations: {} }),
		});
		const notebookEditor = stubInterface<Pick<INotebookEditorDelegate, 'onDidChangeModel' | 'hasModel' | 'onDidChangeOptions' | 'isReadOnly'>>({
			onDidChangeModel: Event.None,
			onDidChangeOptions: Event.None,
			hasModel: (): this is never => false,
			isReadOnly: false,
		});

		// BaseCellEditorOptions extends Disposable, so the store can own it.
		const options = store.add(new BaseCellEditorOptions(notebookEditor, notebookOptions, configurationService, 'python'));
		return { options, configurationService };
	}

	it('applies the default gutter options', () => {
		const { options } = createOptions();
		expect(options.value.folding).toBe(true);
		expect(options.value.lineNumbersMinChars).toBe(2);
		expect(options.value.lineDecorationsWidth).toBe(10);
	});

	it('disables folding when the setting is off', () => {
		const { options } = createOptions({ [POSITRON_NOTEBOOK_FOLDING_KEY]: false });
		expect(options.value.folding).toBe(false);
	});

	it('recomputes folding when the setting changes', () => {
		const { options, configurationService } = createOptions();
		expect(options.value.folding).toBe(true);

		configurationService.setUserConfiguration(POSITRON_NOTEBOOK_FOLDING_KEY, false);
		configurationService.onDidChangeConfigurationEmitter.fire(stubInterface<IConfigurationChangeEvent>({
			affectsConfiguration: (key: string) => key === POSITRON_NOTEBOOK_FOLDING_KEY,
		}));

		expect(options.value.folding).toBe(false);
	});
});
