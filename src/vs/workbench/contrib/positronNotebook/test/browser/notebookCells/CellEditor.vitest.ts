/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { toDisposable } from '../../../../../../base/common/lifecycle.js';
import { CellEditor } from '../../../browser/CellEditor.js';
import { ensureNoLeakedDisposables } from '../../../../../../test/vitest/vitestUtils.js';

describe('CellEditor', () => {
	const disposables = ensureNoLeakedDisposables();

	describe('element', () => {
		it('creates a DOM element with the monaco widget class', () => {
			const editor = disposables.add(new CellEditor());

			expect(editor.element.className).toBe('positron-cell-editor-monaco-widget');
		});

		it('makes the element programmatically focusable but not tab-reachable', () => {
			const editor = disposables.add(new CellEditor());

			// The editor owns its node so it can be reparented and focused
			// without joining the tab order.
			expect(editor.element.tabIndex).toBe(-1);
		});
	});

	describe('register', () => {
		it('returns the disposable it is given', () => {
			const editor = disposables.add(new CellEditor());
			const disposable = toDisposable(() => { });

			expect(editor.register(disposable)).toBe(disposable);
		});

		it('disposes registered disposables when the editor is disposed', () => {
			const editor = new CellEditor();
			let disposed = false;
			editor.register({ dispose: () => { disposed = true; } });

			editor.dispose();

			expect(disposed).toBe(true);
		});
	});
});
