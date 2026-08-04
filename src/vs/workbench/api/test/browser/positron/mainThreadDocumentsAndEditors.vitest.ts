/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Selection } from '../../../../../editor/common/core/selection.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { IEditorPropertiesChangeData } from '../../../common/extHost.protocol.js';
import { ConsoleEditorTestServices } from './consoleEditorTestServices.js';

// Tests for the Positron-only `MainThreadDocumentsAndEditors.registerHiddenTextEditor` method,
// which backs `positron.window.activeConsoleEditor`. See `ConsoleEditorTestServices` for the
// wiring.
describe('MainThreadDocumentsAndEditors (Positron hidden editor)', () => {

	ensureNoLeakedDisposables();

	let services: ConsoleEditorTestServices;

	beforeEach(() => {
		services = new ConsoleEditorTestServices();
	});

	// Registered after `ensureNoLeakedDisposables`, so it runs before the leak check (Vitest runs
	// afterEach hooks in reverse registration order).
	afterEach(() => {
		services.dispose();
	});

	it('makes the editor resolvable by id without touching the core editor channel', () => {
		const model = services.createModel('> ');
		const editor = services.createCodeEditor(model);

		const registration = services.documentsAndEditors.registerHiddenTextEditor('console-1', editor, model);

		// Resolvable by id, so `edit()` / `insertSnippet()` / selection writes from the extension
		// host reach this editor...
		expect(services.documentsAndEditors.getEditor('console-1')).toBeDefined();
		expect(registration.addData).toMatchObject({ id: 'console-1', documentUri: model.uri });

		// ...but invisible to core VS Code editor APIs: no `addedEditors` delta, and no editor
		// state sent on the core channel (posit-dev/positron#780).
		expect(services.coreDeltaMentions('console-1')).toEqual([]);
		expect(services.coreEditorStateCalls('console-1')).toEqual([]);

		registration.dispose();
		expect(services.documentsAndEditors.getEditor('console-1')).toBeUndefined();
		expect(services.coreDeltaMentions('console-1')).toEqual([]);
	});

	it('reports property changes to its own listener rather than the core channel', () => {
		const model = services.createModel('hello');
		const editor = services.createCodeEditor(model);

		const registration = services.add(services.documentsAndEditors.registerHiddenTextEditor('console-2', editor, model));

		const changes: IEditorPropertiesChangeData[] = [];
		services.add(registration.onPropertiesChanged(data => changes.push(data)));

		editor.setSelection(new Selection(1, 1, 1, 4));

		expect(changes.at(-1)?.selections?.selections).toMatchObject([
			{ selectionStartLineNumber: 1, selectionStartColumn: 1, positionLineNumber: 1, positionColumn: 4 }
		]);
		expect(services.coreEditorStateCalls('console-2')).toEqual([]);
	});
});
