/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Event } from '../../../../../base/common/event.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { INotebookEditorDelegate } from '../../../notebook/browser/notebookBrowser.js';
import { NotebookDisplayOptions, NotebookOptions } from '../../../notebook/browser/notebookOptions.js';
import { BaseCellEditorOptions } from '../../browser/BaseCellEditorOptions.js';

describe('BaseCellEditorOptions', () => {
	const store = new DisposableStore();

	afterEach(() => {
		store.clear();
	});

	function createOptions() {
		const configurationService = new TestConfigurationService({ editor: {} });
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
		return store.add(new BaseCellEditorOptions(notebookEditor, notebookOptions, configurationService, 'python'));
	}

	it('applies the default gutter options', () => {
		const options = createOptions();
		expect(options.value.folding).toBe(true);
		expect(options.value.lineNumbersMinChars).toBe(2);
	});

	it('updates the line-number width via setLineNumbersMinChars', () => {
		const options = createOptions();
		expect(options.value.lineNumbersMinChars).toBe(2);
		options.setLineNumbersMinChars(3);
		expect(options.value.lineNumbersMinChars).toBe(3);
	});
});
