/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { ConsoleEditorTestServices } from './consoleEditorTestServices.js';

// Tests for the Positron-only `MainThreadDocumentsAndEditors.registerConsoleEditor` method, which
// backs `positron.window.activeConsoleEditor`. See `ConsoleEditorTestServices` for the wiring.
describe('MainThreadDocumentsAndEditors (Positron console editor)', () => {

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

	it('registers immediately when the code editor already has a model', () => {
		const model = services.createModel('> ');
		const editor = services.createCodeEditor(model);

		const store = services.documentsAndEditors.registerConsoleEditor('console-1', editor);

		expect(services.consoleAdds('console-1')).toHaveLength(1);

		// Disposing the registration removes the editor from the ext host.
		store.dispose();
		expect(services.consoleRemoves('console-1')).toHaveLength(1);
	});

	it('defers registration until a model is attached (the fix)', () => {
		// Console input assigns its code editor before the text model attaches.
		const editor = services.createCodeEditor(undefined);

		services.add(services.documentsAndEditors.registerConsoleEditor('console-2', editor));

		// Nothing registered yet -- a regression that bailed on the missing model would leave
		// `activeConsoleEditor` permanently unresolved here.
		expect(services.consoleAdds('console-2')).toHaveLength(0);

		// Attaching the model fires `onDidChangeModel` with a new url, which triggers registration.
		editor.setModel(services.createModel('> '));
		expect(services.consoleAdds('console-2')).toHaveLength(1);

		// A later model swap must not register the console editor a second time.
		editor.setModel(services.createModel('>> '));
		expect(services.consoleAdds('console-2')).toHaveLength(1);
	});

	it('notifies the caller only once the editor is known to the ext host', () => {
		const editor = services.createCodeEditor(undefined);
		const onRegistered = vi.fn(() => services.consoleAdds('console-3').length);

		services.add(services.documentsAndEditors.registerConsoleEditor('console-3', editor, onRegistered));

		expect(onRegistered).not.toHaveBeenCalled();

		editor.setModel(services.createModel('> '));

		// Called exactly once, and only after the `addedEditors` delta went out -- callers rely on
		// that ordering to avoid announcing an editor the ext host can't resolve yet.
		expect(onRegistered).toHaveBeenCalledTimes(1);
		expect(onRegistered).toHaveReturnedWith(1);
	});
});
