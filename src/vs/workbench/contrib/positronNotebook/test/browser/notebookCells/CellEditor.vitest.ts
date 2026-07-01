/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { toDisposable } from '../../../../../../base/common/lifecycle.js';
import { ContextKeyService } from '../../../../../../platform/contextkey/browser/contextKeyService.js';
import { IContextKeyService } from '../../../../../../platform/contextkey/common/contextkey.js';
import { TestConfigurationService } from '../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { EditorContextKeys } from '../../../../../../editor/common/editorContextKeys.js';
import { IEditorProgressService } from '../../../../../../platform/progress/common/progress.js';
import { createTestContainer } from '../../../../../../test/vitest/positronTestContainer.js';
import { CellEditor } from '../../../browser/CellEditor.js';

describe('CellEditor', () => {
	const ctx = createTestContainer()
		.withWorkbenchServices()
		.build();

	// Use the *real* ContextKeyService: the default MockContextKeyService's
	// createScoped() returns `this`, so it can't model the child scope the
	// scoped-context-key tests below assert. Fresh instance per test so scoped
	// children don't leak across tests.
	beforeEach(() => {
		const contextKeyService = ctx.disposables.add(new ContextKeyService(new TestConfigurationService()));
		ctx.instantiationService.stub(IContextKeyService, contextKeyService);
	});

	function createCellEditor(): CellEditor {
		return ctx.disposables.add(ctx.instantiationService.createInstance(CellEditor));
	}

	describe('element', () => {
		it('creates a DOM element with the monaco widget class', () => {
			const editor = createCellEditor();

			expect(editor.element.className).toBe('positron-cell-editor-monaco-widget');
		});

		it('makes the element programmatically focusable but not tab-reachable', () => {
			const editor = createCellEditor();

			expect(editor.element.tabIndex).toBe(-1);
		});
	});

	describe('scopedContextKeyService', () => {
		it('is a child scope of the cell context key service', () => {
			const parent = ctx.get(IContextKeyService);
			const editor = createCellEditor();

			// A key set on the parent is visible through the child scope (the
			// child walks up the context chain)...
			parent.createKey('positronNotebookCellIsFirst', true);
			expect(
				editor.scopedContextKeyService.getContextKeyValue('positronNotebookCellIsFirst')
			).toBe(true);

			// ...but a key set on the child does not leak up to the parent,
			// proving the scope is a distinct child rather than the parent itself.
			editor.scopedContextKeyService.createKey('cellEditorLocalKey', true);
			expect(
				parent.getContextKeyValue('cellEditorLocalKey')
			).toBeUndefined();
		});

		it('sets the inCompositeEditor context key so standalone keybindings do not fire', () => {
			const editor = createCellEditor();

			expect(
				editor.scopedContextKeyService.getContextKeyValue(EditorContextKeys.inCompositeEditor.key)
			).toBe(true);
		});
	});

	describe('scopedInstantiationService', () => {
		it('scopes IContextKeyService to the editor scope', () => {
			const editor = createCellEditor();

			const contextKeyService = editor.scopedInstantiationService.invokeFunction(
				accessor => accessor.get(IContextKeyService)
			);

			expect(contextKeyService).toBe(editor.scopedContextKeyService);
		});

		it('provides a no-op IEditorProgressService that Monaco can access', async () => {
			const editor = createCellEditor();

			const progressService = editor.scopedInstantiationService.invokeFunction(
				accessor => accessor.get(IEditorProgressService)
			);

			// show() returns a progress reporter that does nothing.
			expect(() => progressService.show(true).done()).not.toThrow();
			// showWhile() resolves once the wrapped promise resolves.
			await expect(progressService.showWhile(Promise.resolve())).resolves.toBeUndefined();
		});
	});

	describe('register', () => {
		it('returns the disposable it is given', () => {
			const editor = createCellEditor();
			const disposable = toDisposable(() => { });

			expect(editor.register(disposable)).toBe(disposable);
		});

		it('disposes registered disposables when the editor is disposed', () => {
			const editor = ctx.instantiationService.createInstance(CellEditor);
			let disposed = false;
			editor.register({ dispose: () => { disposed = true; } });

			editor.dispose();

			expect(disposed).toBe(true);
		});
	});
});
