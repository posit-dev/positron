/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { waitFor, within } from '@testing-library/react';
import { observableValue } from '../../../../../../base/common/observable.js';
import { ISize } from '../../../../../../base/browser/positronReactRenderer.js';
import { IContextKeyService } from '../../../../../../platform/contextkey/common/contextkey.js';
import { ContextKeyService } from '../../../../../../platform/contextkey/browser/contextKeyService.js';
import { TestConfigurationService } from '../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IUserInteractionService } from '../../../../../../platform/userInteraction/browser/userInteractionService.js';
import { UserInteractionService } from '../../../../../../platform/userInteraction/browser/userInteractionServiceImpl.js';
import { createTestContainer } from '../../../../../../test/vitest/positronTestContainer.js';
import { VSBuffer } from '../../../../../../base/common/buffer.js';
import { CellKind, IOutputDto } from '../../../../notebook/common/notebookCommon.js';
import { CellEditor } from '../../../browser/notebookCells/CellEditor.js';
import { NotebookCellEditorDelegate } from '../../../browser/notebookCells/notebookCellEditorDelegate.js';
import { PositronNotebookCellGeneral } from '../../../browser/PositronNotebookCells/PositronNotebookCell.js';
import { createTestPositronNotebookInstance, TestPositronNotebookInstance } from '../testPositronNotebookInstance.js';

// Register a real editor contribution by side-effect so EditorExtensionsRegistry
// is populated when CellEditor builds its editor.
import '../../../../../../editor/contrib/folding/browser/folding.js';

describe('CellEditor', () => {
	const ctx = createTestContainer()
		.withNotebookEditorServices()
		// CellEditor builds a real CodeEditorWidget and calls setModel(), which
		// constructs the editor view; that view needs IUserInteractionService to
		// create its DOM focus tracker. Use the real implementation so focus
		// wiring matches production.
		.stub(IUserInteractionService, new UserInteractionService())
		.build();

	// Use a real ContextKeyService (not the preset MockContextKeyService) so the
	// editor's createScoped() against the cell's scope allocates a genuine
	// scoped service that can be reparented later. Fresh per test so scoped
	// children don't leak across tests.
	beforeEach(() => {
		const contextKeyService = ctx.disposables.add(new ContextKeyService(new TestConfigurationService()));
		ctx.instantiationService.stub(IContextKeyService, contextKeyService);
	});

	let currentNotebook: TestPositronNotebookInstance | undefined;
	let currentContainer: HTMLElement | undefined;
	let currentCellEditor: CellEditor | undefined;

	afterEach(async () => {
		currentCellEditor?.dispose();
		currentCellEditor = undefined;
		currentNotebook?.dispose();
		currentNotebook = undefined;
		currentContainer?.remove();
		currentContainer = undefined;
		await new Promise(resolve => setTimeout(resolve, 0));
	});

	function textOutput(id: string): IOutputDto {
		return { outputId: id, outputs: [{ mime: 'text/plain', data: VSBuffer.fromString('out') }] };
	}

	interface CreateCellEditorOptions {
		language?: string;
		withOutputs?: boolean;
		size?: ISize;
		/** Append the editor's owned element into a live cell container. */
		mount?: boolean;
	}

	// Construct a CellEditor directly (the production construction path, minus
	// React) for a single-cell notebook and wait for its model to attach.
	async function createCellEditor(options: CreateCellEditorOptions = {}) {
		const { language = 'python', withOutputs = false, size, mount = false } = options;
		const notebook = createTestPositronNotebookInstance(
			[['x = 1', language, CellKind.Code, withOutputs ? [textOutput('o1')] : []]],
			ctx,
		);
		currentNotebook = notebook;
		const cell = notebook.cells.get()[0] as PositronNotebookCellGeneral;

		// Production's NotebookCellWrapper attaches the cell container (which wires
		// up the cell's scoped context key service); CellEditor's scope is a child
		// of it, so it must exist before construction.
		const cellContainer = document.createElement('div');
		cellContainer.tabIndex = 0;
		document.body.appendChild(cellContainer);
		currentContainer = cellContainer;
		notebook.container.set(cellContainer, undefined);
		cell.attachContainer(cellContainer);

		const sizeObs = observableValue<ISize>('test-size', size ?? { width: 800, height: 600 });
		const delegate = new NotebookCellEditorDelegate(notebook, sizeObs);
		const cellEditor = notebook.scopedInstantiationService.createInstance(CellEditor, cell, delegate);
		currentCellEditor = cellEditor;

		if (mount) {
			cellContainer.appendChild(cellEditor.element);
		}

		// The editor resolves its model asynchronously; wait for setModel().
		await waitFor(() => expect(cell.currentEditor?.getModel()).toBeTruthy());

		return { notebook, cell, cellEditor, cellContainer, sizeObs };
	}

	describe('owned DOM', () => {
		it('owns a layout-transparent root element', async () => {
			const { cellEditor } = await createCellEditor();
			expect(cellEditor.element).toHaveClass('positron-cell-editor-root');
		});

		it('does not attach its root anywhere until the host mounts it', async () => {
			const { cellEditor } = await createCellEditor();
			// The editor never reaches out to host DOM; the root has no parent
			// until the host appends it.
			expect(cellEditor.element.parentElement).toBeNull();
		});

		it('appends into a host mount point when the host mounts it', async () => {
			const { cellEditor, cellContainer } = await createCellEditor({ mount: true });
			expect(cellEditor.element.parentElement).toBe(cellContainer);
		});

		it('contains the editor container with the expected class and tab order', async () => {
			const { cellEditor } = await createCellEditor();
			// The .positron-cell-editor-monaco-widget class is itself the contract:
			// existing CSS and NotebookCellWrapper's click guard
			// (.closest('.positron-cell-editor-monaco-widget')) target it. It is a
			// structural div with no semantic role, so assert on the class directly.
			// eslint-disable-next-line no-restricted-syntax -- structural invariant: this class is the CSS/click-guard contract
			const editorContainer = cellEditor.element.querySelector<HTMLElement>('.positron-cell-editor-monaco-widget');
			expect(editorContainer).not.toBeNull();
			// The editor container is removed from the tab order; Enter on the
			// focus target is the entry point instead.
			expect(editorContainer).toHaveAttribute('tabindex', '-1');
		});

		it('hosts the Monaco editor inside the editor container', async () => {
			const { cell, cellEditor } = await createCellEditor();
			// eslint-disable-next-line no-restricted-syntax -- structural invariant: this class is the CSS/click-guard contract
			const editorContainer = cellEditor.element.querySelector('.positron-cell-editor-monaco-widget');
			expect(editorContainer!.contains(cell.currentEditor!.getContainerDomNode())).toBe(true);
		});

		it('contains an accessible focus target', async () => {
			const { cellEditor } = await createCellEditor({ mount: true });
			// The focus target is semantic: a role="button" labelled "Edit cell".
			const focusTarget = within(cellEditor.element).getByRole('button', { name: /edit cell/i });
			expect(focusTarget).toBeInTheDocument();
		});
	});

	describe('focus target tab order', () => {
		it('is in the tab order when the cell has outputs', async () => {
			const { cellEditor } = await createCellEditor({ withOutputs: true });
			const focusTarget = within(cellEditor.element).getByRole('button', { name: /edit cell/i });
			expect(focusTarget).toHaveAttribute('tabindex', '0');
		});

		it('is out of the tab order when the cell has no outputs', async () => {
			const { cellEditor } = await createCellEditor({ withOutputs: false });
			const focusTarget = within(cellEditor.element).getByRole('button', { name: /edit cell/i });
			expect(focusTarget).toHaveAttribute('tabindex', '-1');
		});
	});

	describe('lifecycle', () => {
		it('attaches its editor to the cell', async () => {
			const { cell, cellEditor } = await createCellEditor();
			expect(cell.currentEditor).toBe(cellEditor.editor);
		});

		it('detaches and disposes the editor on dispose', async () => {
			const { cell, cellEditor } = await createCellEditor();
			const editor = cellEditor.editor;
			const dispose = vi.spyOn(editor, 'dispose');

			cellEditor.dispose();
			currentCellEditor = undefined;

			expect(dispose).toHaveBeenCalledTimes(1);
			expect(cell.currentEditor).toBeUndefined();
		});
	});
});
