/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { waitFor, within } from '@testing-library/react';
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
		// up the cell's scoped context key service) before mounting the editor.
		// CellEditor construction no longer depends on it (only setCell reparents
		// onto it), but attach it here so the helper mirrors the production order.
		const cellContainer = document.createElement('div');
		cellContainer.tabIndex = 0;
		document.body.appendChild(cellContainer);
		currentContainer = cellContainer;
		notebook.container.set(cellContainer, undefined);
		cell.attachContainer(cellContainer);

		notebook.layout(size ?? { width: 800, height: 600 });
		const cellEditor = notebook.scopedInstantiationService.createInstance(CellEditor);
		cellEditor.setCell(cell);
		currentCellEditor = cellEditor;

		if (mount) {
			cellContainer.appendChild(cellEditor.element);
		}

		// The editor resolves its model asynchronously; wait for setModel().
		await waitFor(() => expect(cell.currentEditor?.getModel()).toBeTruthy());

		return { notebook, cell, cellEditor, cellContainer };
	}

	// Construct a CellEditor over a multi-cell notebook so setCell() can rebind
	// it between cells. Each cell gets its own attached container (so each has a
	// scoped context key service) nested inside a shared notebook container.
	async function createRebindableCellEditor(
		specs: Array<{ source: string; language?: string; withOutputs?: boolean }>,
	) {
		const notebook = createTestPositronNotebookInstance(
			specs.map(s => [s.source, s.language ?? 'python', CellKind.Code, s.withOutputs ? [textOutput('o1')] : []]),
			ctx,
		);
		currentNotebook = notebook;

		// Shared notebook container drives the editor's containsElement() check.
		const notebookContainer = document.createElement('div');
		document.body.appendChild(notebookContainer);
		currentContainer = notebookContainer;
		notebook.container.set(notebookContainer, undefined);

		const cells = notebook.cells.get() as PositronNotebookCellGeneral[];
		const cellContainers = cells.map(cell => {
			const el = document.createElement('div');
			el.tabIndex = 0;
			notebookContainer.appendChild(el);
			cell.attachContainer(el);
			return el;
		});

		const cellEditor = notebook.scopedInstantiationService.createInstance(CellEditor);
		cellEditor.setCell(cells[0]);
		currentCellEditor = cellEditor;
		cellContainers[0].appendChild(cellEditor.element);

		await waitFor(() => expect(cells[0].currentEditor?.getModel()).toBeTruthy());

		return { notebook, cells, cellEditor, cellContainers };
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

	describe('construction and binding timing', () => {
		// The cell's scoped context key service is created lazily in
		// attachContainer() - it does not exist until the host mounts the cell. The
		// refactor decoupled construction (which only needs the injected, notebook
		// -level IContextKeyService and instantiation service) from binding (which
		// reparents onto the cell's scope). These tests pin that ordering so a
		// pooled editor can be built before any cell scope is ready.

		// Build a notebook + delegate without attaching the cell's container, so
		// cell.scopedContextKeyService is still undefined.
		function createUnboundEditor() {
			const notebook = createTestPositronNotebookInstance(
				[['x = 1', 'python', CellKind.Code, []]],
				ctx,
			);
			currentNotebook = notebook;
			const cell = notebook.cells.get()[0] as PositronNotebookCellGeneral;

			const notebookContainer = document.createElement('div');
			document.body.appendChild(notebookContainer);
			currentContainer = notebookContainer;
			notebook.container.set(notebookContainer, undefined);

			const cellEditor = notebook.scopedInstantiationService.createInstance(CellEditor);
			currentCellEditor = cellEditor;

			return { notebook, cell, cellEditor, cellContainer: notebookContainer };
		}

		it('constructs before the cell scope exists', () => {
			const { cell, cellEditor } = createUnboundEditor();
			// Precondition: the cell has no scoped context key service yet.
			expect(cell.scopedContextKeyService).toBeUndefined();
			// Construction still produced a working editor + owned DOM, built from
			// the injected notebook-level instantiation/context-key services.
			expect(cellEditor.editor).toBeTruthy();
			expect(cellEditor.element).toHaveClass('positron-cell-editor-root');
			// The composite-editor marker is set on the editor scope at construction,
			// independent of any cell binding.
			expect(cellEditor.editor.contextKeyService.getContextKeyValue('inCompositeEditor')).toBe(true);
		});

		it('reparents onto the cell scope once it becomes ready and is bound', async () => {
			const { cell, cellEditor, cellContainer } = createUnboundEditor();

			// The cell scope becomes ready only now (mirrors attachContainer firing
			// after the editor was already constructed).
			cell.attachContainer(cellContainer);
			expect(cell.scopedContextKeyService).toBeTruthy();
			cell.scopedContextKeyService!.createKey('testLateBindKey', 'ready');

			cellEditor.setCell(cell);
			await waitFor(() => expect(cell.currentEditor?.getModel()).toBeTruthy());

			// The editor's descendant scope now resolves the late-created cell key,
			// proving setCell reparented onto a scope that did not exist at
			// construction time.
			expect(cellEditor.editor.contextKeyService.getContextKeyValue('testLateBindKey')).toBe('ready');
			expect(cellEditor.editor.contextKeyService.getContextKeyValue('inCompositeEditor')).toBe(true);
		});
	});

	describe('context key service scoping', () => {
		// The editor's context key service must sit in the hierarchy
		//   cell.scopedContextKeyService -> editor scope -> editor.contextKeyService
		// The refactor builds the editor scope from an injected IContextKeyService
		// and reparents it onto the cell in setCell(), so these assertions guard
		// that the chain is wired correctly from construction (not just on rebind).

		it('marks the editor as part of a composite editor', async () => {
			const { cellEditor } = await createCellEditor();
			// inCompositeEditor is set on the editor scope CellEditor builds; it must
			// be visible from the editor's own (descendant) context key service so
			// standalone editor keybindings stay suppressed.
			expect(cellEditor.editor.contextKeyService.getContextKeyValue('inCompositeEditor')).toBe(true);
		});

		it('resolves the bound cell\'s context keys through the editor scope', async () => {
			const { cell, cellEditor } = await createCellEditor();
			// A key defined only on the cell's scoped service must resolve from the
			// editor's descendant service after the initial bind (setCell reparents
			// the editor scope onto the cell).
			cell.scopedContextKeyService!.createKey('testInitialCellKey', 'bound');
			expect(cellEditor.editor.contextKeyService.getContextKeyValue('testInitialCellKey')).toBe('bound');
		});

		it('isolates editor-local keys from the bound cell\'s scope', async () => {
			const { cell, cellEditor } = await createCellEditor();
			// Keys created on the editor's own service must not leak up into the
			// cell's scope - confirming the editor service is a genuine descendant
			// scope, not the cell's scope itself.
			cellEditor.editor.contextKeyService.createKey('testEditorLocalKey', 'editor');
			expect(cell.scopedContextKeyService!.getContextKeyValue('testEditorLocalKey')).toBeUndefined();
		});
	});

	describe('setCell rebind', () => {
		it('is a no-op when rebinding to the same cell', async () => {
			const { cells, cellEditor } = await createRebindableCellEditor([{ source: 'a = 1' }, { source: 'b = 2' }]);
			const attachSpy = vi.spyOn(cells[0], 'attachEditor');

			cellEditor.setCell(cells[0]);

			expect(attachSpy).not.toHaveBeenCalled();
		});

		it('reuses the same editor widget and owned DOM across a rebind', async () => {
			const { cells, cellEditor } = await createRebindableCellEditor([{ source: 'a = 1' }, { source: 'b = 2' }]);
			const editorBefore = cellEditor.editor;
			const elementBefore = cellEditor.element;

			cellEditor.setCell(cells[1]);
			await waitFor(() => expect(cellEditor.editor.getModel()?.getValue()).toBe('b = 2'));

			expect(cellEditor.editor).toBe(editorBefore);
			expect(cellEditor.element).toBe(elementBefore);
		});

		it('swaps the model and attaches to the new cell', async () => {
			const { cells, cellEditor } = await createRebindableCellEditor([{ source: 'a = 1' }, { source: 'b = 2' }]);
			const modelBefore = cellEditor.editor.getModel();

			cellEditor.setCell(cells[1]);
			await waitFor(() => expect(cellEditor.editor.getModel()).not.toBe(modelBefore));

			expect(cells[1].currentEditor).toBe(cellEditor.editor);
			expect(cellEditor.editor.getModel()?.getValue()).toBe('b = 2');
		});

		it('detaches the previous cell on rebind', async () => {
			const { cells, cellEditor } = await createRebindableCellEditor([{ source: 'a = 1' }, { source: 'b = 2' }]);
			expect(cells[0].currentEditor).toBe(cellEditor.editor);

			cellEditor.setCell(cells[1]);
			await waitFor(() => expect(cellEditor.editor.getModel()?.getValue()).toBe('b = 2'));

			expect(cells[0].currentEditor).toBeUndefined();
		});

		it('re-points the editor scope at the new cell so cell-level keys resolve', async () => {
			const { cells, cellEditor } = await createRebindableCellEditor([{ source: 'a = 1' }, { source: 'b = 2' }]);
			// A cell-level key defined on each cell's scoped service. The editor's
			// internal context service is a descendant of the bound cell's scope, so
			// it should resolve whichever cell the editor is currently bound to.
			cells[0].scopedContextKeyService!.createKey('testRebindCellKey', 'A');
			cells[1].scopedContextKeyService!.createKey('testRebindCellKey', 'B');
			expect(cellEditor.editor.contextKeyService.getContextKeyValue('testRebindCellKey')).toBe('A');

			cellEditor.setCell(cells[1]);
			await waitFor(() => expect(cellEditor.editor.getModel()?.getValue()).toBe('b = 2'));

			expect(cellEditor.editor.contextKeyService.getContextKeyValue('testRebindCellKey')).toBe('B');
		});

		it('updates the focus target tab order for the new cell outputs', async () => {
			const { cells, cellEditor } = await createRebindableCellEditor([
				{ source: 'a = 1', withOutputs: false },
				{ source: 'b = 2', withOutputs: true },
			]);
			const focusTarget = within(cellEditor.element).getByRole('button', { name: /edit cell/i });
			expect(focusTarget).toHaveAttribute('tabindex', '-1');

			cellEditor.setCell(cells[1]);
			await waitFor(() => expect(focusTarget).toHaveAttribute('tabindex', '0'));
		});

		it('rebinds across a language change without recreating the editor', async () => {
			const { cells, cellEditor } = await createRebindableCellEditor([
				{ source: 'a = 1', language: 'python' },
				{ source: 'SELECT 1', language: 'sql' },
			]);
			const editorBefore = cellEditor.editor;

			cellEditor.setCell(cells[1]);
			await waitFor(() => expect(cellEditor.editor.getModel()?.getValue()).toBe('SELECT 1'));

			expect(cellEditor.editor).toBe(editorBefore);
		});
	});

	describe('reset', () => {
		it('detaches the editor from the cell', async () => {
			const { cell, cellEditor } = await createCellEditor({ mount: true });
			expect(cell.currentEditor).toBe(cellEditor.editor);

			cellEditor.reset();

			expect(cell.currentEditor).toBeUndefined();
		});

		it('removes the owned root from its mount point', async () => {
			const { cellEditor, cellContainer } = await createCellEditor({ mount: true });
			expect(cellEditor.element.parentElement).toBe(cellContainer);

			cellEditor.reset();

			expect(cellEditor.element.parentElement).toBeNull();
		});

		it('clears the editor model', async () => {
			const { cellEditor } = await createCellEditor({ mount: true });
			expect(cellEditor.editor.getModel()).toBeTruthy();

			cellEditor.reset();

			expect(cellEditor.editor.getModel()).toBeNull();
		});

		it('keeps the live editor widget and owned DOM for reuse', async () => {
			const { cellEditor } = await createCellEditor({ mount: true });
			const editorBefore = cellEditor.editor;
			const elementBefore = cellEditor.element;
			const dispose = vi.spyOn(editorBefore, 'dispose');

			cellEditor.reset();

			expect(dispose).not.toHaveBeenCalled();
			expect(cellEditor.editor).toBe(editorBefore);
			expect(cellEditor.element).toBe(elementBefore);
		});

		it('rebinds to a cell after a reset, re-attaching and re-mounting', async () => {
			const { cells, cellEditor, cellContainers } = await createRebindableCellEditor([
				{ source: 'a = 1' },
				{ source: 'b = 2' },
			]);
			cellEditor.reset();
			expect(cells[0].currentEditor).toBeUndefined();

			// Re-acquire for a different cell, mirroring the pool reuse path: mount
			// the owned element then bind.
			cellContainers[1].appendChild(cellEditor.element);
			cellEditor.setCell(cells[1]);
			await waitFor(() => expect(cellEditor.editor.getModel()?.getValue()).toBe('b = 2'));

			expect(cells[1].currentEditor).toBe(cellEditor.editor);
			expect(cellEditor.element.parentElement).toBe(cellContainers[1]);
		});

		it('rebinds to the same cell after a reset', async () => {
			const { cell, cellEditor, cellContainer } = await createCellEditor({ mount: true });
			cellEditor.reset();

			// setCell is normally a no-op for the same cell, but a reset cleared the
			// binding so the same cell must re-bind (and re-attach) cleanly.
			cellContainer.appendChild(cellEditor.element);
			cellEditor.setCell(cell);
			await waitFor(() => expect(cell.currentEditor?.getModel()).toBeTruthy());

			expect(cell.currentEditor).toBe(cellEditor.editor);
		});

		it('is a no-op after dispose', async () => {
			const { cellEditor } = await createCellEditor({ mount: true });
			cellEditor.dispose();
			currentCellEditor = undefined;

			// A reset racing a pool disposal during unmount must not touch the
			// already-disposed editor.
			expect(() => cellEditor.reset()).not.toThrow();
		});
	});
});
