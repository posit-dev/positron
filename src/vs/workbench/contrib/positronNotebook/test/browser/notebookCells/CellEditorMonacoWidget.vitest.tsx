/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { observableValue } from '../../../../../../base/common/observable.js';
import { ISize } from '../../../../../../base/browser/positronReactRenderer.js';
import { IContextKeyService, IScopedContextKeyService } from '../../../../../../platform/contextkey/common/contextkey.js';
import { ContextKeyService } from '../../../../../../platform/contextkey/browser/contextKeyService.js';
import { IConfigurationChangeEvent, IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { EditorOption } from '../../../../../../editor/common/config/editorOptions.js';
import { ITextFileService } from '../../../../../services/textfile/common/textfiles.js';
import { InQuickPickContextKey } from '../../../../../browser/quickaccess.js';
import { IUserInteractionService } from '../../../../../../platform/userInteraction/browser/userInteractionService.js';
import { UserInteractionService } from '../../../../../../platform/userInteraction/browser/userInteractionServiceImpl.js';
import { setupRTLRenderer } from '../../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../../test/vitest/stubInterface.js';
import { FloatingEditorClickMenu } from '../../../../../browser/codeeditor.js';
import { VSBuffer } from '../../../../../../base/common/buffer.js';
import { CellKind, IOutputDto } from '../../../../notebook/common/notebookCommon.js';
import { CellSelectionType, SelectionState } from '../../../browser/selectionMachine.js';
import { NotebookContextKeys } from '../../../common/notebookContextKeys.js';
import { NotebookInstanceProvider } from '../../../browser/NotebookInstanceProvider.js';
import { EnvironentProvider } from '../../../browser/EnvironmentProvider.js';
import { CellEditorMonacoWidget } from '../../../browser/notebookCells/CellEditorMonacoWidget.js';
import { PositronNotebookCellGeneral } from '../../../browser/PositronNotebookCells/PositronNotebookCell.js';
import { createTestPositronNotebookInstance } from '../testPositronNotebookInstance.js';

// Register a couple of real editor contributions by side-effect so the
// EditorExtensionsRegistry is populated when the widget builds its editor.
// Without these imports the registry could be empty and the skip-list
// assertions below would pass vacuously. `findController` is on CellEditor's
// skip-list; `folding` is not, so together they exercise both sides of the
// filter -- now driven through the real React widget rather than CellEditor
// directly.
import '../../../../../../editor/contrib/find/browser/findController.js';
import '../../../../../../editor/contrib/folding/browser/folding.js';

describe('CellEditorMonacoWidget', () => {
	const ctx = createTestContainer()
		.withNotebookEditorServices()
		.withReactServices()
		// The widget builds a real CodeEditorWidget and calls setModel(), which
		// constructs the editor view; that view needs IUserInteractionService to
		// create its DOM focus tracker. The notebook-editor preset doesn't stub
		// it (the auto-attached TestCodeEditor wires it up itself).
		//
		// Use the *real* UserInteractionService (not MockUserInteractionService)
		// so the editor's DOM focus tracker wires up to genuine jsdom
		// focus/blur/focusin/focusout events. This is what lets editor.focus() in
		// a test fire onDidFocusEditorWidget and drive the real edit-mode entry,
		// blur-exit, and focus-restore paths -- the mock suppresses all of that.
		.stub(IUserInteractionService, new UserInteractionService())
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	// Use the *real* ContextKeyService (not the container's default
	// MockContextKeyService, whose getContext() returns null). The widget's blur
	// handler calls contextKeyService.getContext(activeElement) and reads guard
	// keys off it to decide whether to stay in edit mode; the real service walks
	// the DOM scope chain so createScoped() keys on an element are visible, which
	// is exactly what the overlay-guard test relies on. Stub a fresh instance per
	// test (registered for disposal) since scoped children would otherwise leak
	// across tests. This beforeEach runs after the builder's, so it overrides the
	// preset's MockContextKeyService on the same instantiation service.
	beforeEach(() => {
		const contextKeyService = ctx.disposables.add(new ContextKeyService(new TestConfigurationService()));
		ctx.instantiationService.stub(IContextKeyService, contextKeyService);
	});

	// Notebook rendered by the current test. Disposed in afterEach below.
	let currentNotebook: { dispose(): void } | undefined;
	// Container appended to document.body by renderWidget; removed in afterEach.
	let currentContainer: HTMLElement | undefined;

	afterEach(async () => {
		// Dispose the notebook (and its cells) explicitly here so the cell
		// releases its resolved text-model reference. The text-model resolver
		// disposes the underlying TextFileEditorModel asynchronously, so flush a
		// macrotask to let that settle before the builder's leak check runs.
		// This afterEach is registered after the builder's, so it runs first.
		currentNotebook?.dispose();
		currentNotebook = undefined;
		// Remove the manually-appended container (RTL cleanup() only unmounts the
		// React tree; it doesn't touch nodes we appended to document.body).
		currentContainer?.remove();
		currentContainer = undefined;
		await new Promise(resolve => setTimeout(resolve, 0));
	});

	// A single text output, enough to make cell.outputs non-empty. The focus
	// trap's tab order and the exit-editor focus-restore target both branch on
	// whether the cell has outputs.
	function textOutput(id: string): IOutputDto {
		return { outputId: id, outputs: [{ mime: 'text/plain', data: VSBuffer.fromString('out') }] };
	}

	// Run an action inside act() and flush a macrotask so the editor's DOM focus
	// tracker fires its 0ms blur timeout (see dom.ts FocusTracker.onBlur) and the
	// resulting focus/blur handoff settles before the test asserts.
	async function actAndSettle(action: () => void) {
		await act(async () => {
			action();
			await new Promise(resolve => setTimeout(resolve, 0));
		});
	}

	interface RenderWidgetOptions {
		/** Cell language. Defaults to python. */
		language?: string;
		/** Seed the cell with outputs so `cell.outputs` is non-empty. */
		withOutputs?: boolean;
		/** The size observable the widget's resize autorun reads. */
		size?: ISize;
	}

	// Mount a CellEditorMonacoWidget for `cell` inside `notebookContainer`, in
	// production-like nesting (notebook container > cell container > widget).
	// The widget builds a real CodeEditorWidget in its effect and attaches it to
	// the cell, so `cell.currentEditor` is the editor the widget owns.
	//
	// The whole tree is live under document.body: the focus/blur handlers read
	// `instance.currentContainer.contains(activeElement)` and the editor's DOM
	// focus tracker only fires on a connected node.
	async function mountCellWidget(
		notebook: ReturnType<typeof createTestPositronNotebookInstance>,
		cell: PositronNotebookCellGeneral,
		notebookContainer: HTMLElement,
		size?: ISize,
	) {
		const cellContainer = document.createElement('div');
		// Production's NotebookCellWrapper gives the cell container tabIndex=0;
		// mirror that so it can receive focus during focus-restore.
		cellContainer.tabIndex = 0;
		notebookContainer.appendChild(cellContainer);

		// The widget bails out until the cell has a scoped context key service,
		// which production wires up via NotebookCellWrapper's container ref.
		cell.attachContainer(cellContainer);

		const environmentBundle = {
			size: observableValue<ISize>('test-size', size ?? { width: 800, height: 600 }),
			scopedContextKeyProviderCallback: () => stubInterface<IScopedContextKeyService>({}),
		};

		const result = rtl.render(
			<NotebookInstanceProvider instance={notebook}>
				<EnvironentProvider environmentBundle={environmentBundle}>
					<CellEditorMonacoWidget cell={cell} />
				</EnvironentProvider>
			</NotebookInstanceProvider>,
			{ container: cellContainer },
		);

		// The widget resolves the cell's text model asynchronously and calls
		// editor.setModel(). Wait for that to settle before returning so the
		// resolved model reference is registered to the (still-alive) cell and
		// disposed with it -- otherwise it resolves after teardown and leaks.
		await waitFor(() => expect(cell.currentEditor?.getModel()).toBeTruthy());

		return { result, environmentBundle };
	}

	// Build the production-like notebook container, attach it to the document,
	// and register it as the notebook's currentContainer so focus events fire
	// and the contains() guards resolve.
	function attachNotebookContainer(notebook: ReturnType<typeof createTestPositronNotebookInstance>) {
		const notebookContainer = document.createElement('div');
		document.body.appendChild(notebookContainer);
		currentContainer = notebookContainer;
		notebook.container.set(notebookContainer, undefined);
		return notebookContainer;
	}

	// Render CellEditorMonacoWidget for a single-cell notebook.
	async function renderWidget(options: RenderWidgetOptions = {}) {
		const { language = 'python', withOutputs = false, size } = options;
		const notebook = createTestPositronNotebookInstance(
			[['x = 1', language, CellKind.Code, withOutputs ? [textOutput('o1')] : []]],
			ctx,
		);
		currentNotebook = notebook;
		const cell = notebook.cells.get()[0] as PositronNotebookCellGeneral;

		const notebookContainer = attachNotebookContainer(notebook);
		const { result, environmentBundle } = await mountCellWidget(notebook, cell, notebookContainer, size);

		return { notebook, cell, result, environmentBundle };
	}

	// Render a 2-cell notebook with a live editor widget on cell B (the cell
	// receiving the click). Cell A gets no widget -- it only needs to be
	// selectable via the state machine, which the auto-attached TestCodeEditor
	// already satisfies.
	async function renderTwoCellWidgetOnB() {
		const notebook = createTestPositronNotebookInstance(
			[['a = 1', 'python', CellKind.Code, []], ['b = 2', 'python', CellKind.Code, []]],
			ctx,
		);
		currentNotebook = notebook;
		const [cellA, cellB] = notebook.cells.get() as PositronNotebookCellGeneral[];

		const notebookContainer = attachNotebookContainer(notebook);
		await mountCellWidget(notebook, cellB, notebookContainer);

		return { notebook, cellA, cellB };
	}

	it('attaches a code editor to the cell', async () => {
		const { cell } = await renderWidget();
		expect(cell.currentEditor).toBeDefined();
	});

	it('excludes notebook-incompatible contributions', async () => {
		const { cell } = await renderWidget();
		expect(cell.currentEditor!.getContribution('editor.contrib.findController')).toBeNull();
		expect(cell.currentEditor!.getContribution(FloatingEditorClickMenu.ID)).toBeNull();
	});

	it('keeps editor contributions that are not skipped', async () => {
		const { cell } = await renderWidget();
		expect(cell.currentEditor!.getContribution('editor.contrib.folding')).not.toBeNull();
	});

	it('applies the Positron notebook option overrides', async () => {
		const { cell } = await renderWidget();
		expect({
			padding: cell.currentEditor!.getOption(EditorOption.padding),
			tabIndex: cell.currentEditor!.getRawOptions().tabIndex,
		}).toMatchInlineSnapshot(`
			{
			  "padding": {
			    "bottom": 16,
			    "top": 16,
			  },
			  "tabIndex": -1,
			}
		`);
	});

	it('re-applies the overrides when the cell options change', async () => {
		const { cell } = await renderWidget();
		const updateOptions = vi.spyOn(cell.currentEditor!, 'updateOptions');

		// Fire a config change through the same TestConfigurationService that the
		// widget's CellEditorOptions/BaseCellEditorOptions subscribe to. This drives
		// the real live-update path: config change -> BaseCellEditorOptions ->
		// CellEditorOptions.onDidChange -> CellEditor re-applies its overrides.
		await act(async () => {
			const configurationService = ctx.get(IConfigurationService) as TestConfigurationService;
			configurationService.onDidChangeConfigurationEmitter.fire(
				stubInterface<IConfigurationChangeEvent>({
					affectsConfiguration: (key: string) => key === 'editor',
				})
			);
		});

		// The re-applied options must still carry the Positron overrides -- the
		// whole point of rebuilding them on every change is that the overrides are
		// never lost on update. Project to just the override fields so unrelated
		// default editor options don't make this brittle.
		const reappliedOptions = updateOptions.mock.calls[0]?.[0] ?? {};
		expect({
			padding: reappliedOptions.padding,
			tabIndex: reappliedOptions.tabIndex,
			verticalScrollbarSize: reappliedOptions.scrollbar?.verticalScrollbarSize,
			horizontalScrollbarSize: reappliedOptions.scrollbar?.horizontalScrollbarSize,
		}).toMatchInlineSnapshot(`
			{
			  "horizontalScrollbarSize": 8,
			  "padding": {
			    "bottom": 16,
			    "top": 16,
			  },
			  "tabIndex": -1,
			  "verticalScrollbarSize": 8,
			}
		`);
	});

	it('disposes and detaches the editor when unmounted', async () => {
		const { cell, result } = await renderWidget();
		const editor = cell.currentEditor!;
		const dispose = vi.spyOn(editor, 'dispose');

		result.unmount();

		expect(dispose).toHaveBeenCalledTimes(1);
		expect(cell.currentEditor).toBeUndefined();
	});

	describe('resize', () => {
		it('lays out the editor when the environment size changes', async () => {
			const { cell, environmentBundle } = await renderWidget();
			const layout = vi.spyOn(cell.currentEditor!, 'layout');

			// The widget's resize autorun reads environment.size; firing a new
			// size must re-lay out the editor so it tracks the notebook width.
			act(() => {
				environmentBundle.size.set({ width: 400, height: 600 }, undefined);
			});

			expect(layout).toHaveBeenCalled();
		});

		it('lays out the editor when its content size changes', async () => {
			const { cell } = await renderWidget();
			const editor = cell.currentEditor!;
			const model = editor.getModel()!;
			const layout = vi.spyOn(editor, 'layout');

			// Append lines to grow the editor's content height. Edit the resolved
			// model in place via applyEdits (rather than setValue, which churns the
			// TextFileEditorModel layer) so the only observable effect is the
			// content-size growth the onDidContentSizeChange handler reacts to by
			// re-laying out the editor to fit its text.
			await act(async () => {
				const end = model.getFullModelRange().getEndPosition();
				model.applyEdits([{
					range: { startLineNumber: end.lineNumber, startColumn: end.column, endLineNumber: end.lineNumber, endColumn: end.column },
					text: '\ny = 2\nz = 3\nw = 4\n',
				}]);
			});

			await waitFor(() => expect(layout).toHaveBeenCalled());

			// The edit marked the underlying TextFileEditorModel dirty, which
			// blocks the notebook's async model disposal (it waits for the model
			// to be saved or reverted). Revert so teardown can dispose cleanly.
			await ctx.get(ITextFileService).revert(cell.uri);
		});
	});

	describe('focus requests', () => {
		it('focuses the editor when this cell is the editing cell', async () => {
			const { notebook, cell } = await renderWidget();
			const focus = vi.spyOn(cell.currentEditor!, 'focus');

			// Put the cell into edit mode, then signal a focus request: the
			// widget's autorun should drive focus into the Monaco editor.
			act(() => {
				notebook.selectionStateMachine.selectCell(cell, CellSelectionType.Edit);
				cell.requestEditorFocus();
			});

			await waitFor(() => expect(focus).toHaveBeenCalled());
		});

		it('ignores a focus request when this cell is not being edited', async () => {
			const { notebook, cell } = await renderWidget();
			const focus = vi.spyOn(cell.currentEditor!, 'focus');

			// A focus request that arrives while the cell is only selected (not
			// editing) must be ignored, so a stale request can't yank focus back
			// after the user has navigated away.
			act(() => {
				notebook.selectionStateMachine.selectCell(cell, CellSelectionType.Normal);
				cell.requestEditorFocus();
			});

			expect(focus).not.toHaveBeenCalled();
		});
	});

	describe('focus target', () => {
		it('is in the tab order only when the cell has outputs', async () => {
			await renderWidget({ withOutputs: true });
			// The focus target is the role="button" with the "Edit cell" aria-label.
			const targetWithOutputs = screen.getByRole('button', { name: /edit cell/i });
			expect(targetWithOutputs).toHaveAttribute('tabindex', '0');
		});

		it('is out of the tab order when the cell has no outputs', async () => {
			await renderWidget({ withOutputs: false });
			const targetNoOutputs = screen.getByRole('button', { name: /edit cell/i });
			expect(targetNoOutputs).toHaveAttribute('tabindex', '-1');
		});

		it('focuses the editor when Enter is pressed on it', async () => {
			const { cell } = await renderWidget({ withOutputs: true });
			const focus = vi.spyOn(cell.currentEditor!, 'focus');
			const user = userEvent.setup();

			const target = screen.getByRole('button', { name: /edit cell/i });
			target.focus();
			await user.keyboard('{Enter}');

			expect(focus).toHaveBeenCalled();
		});
	});

	describe('edit mode entry on editor focus', () => {
		it('enters edit mode and sets the cell-editor-focused key when the editor is focused', async () => {
			const { notebook, cell } = await renderWidget();
			const editor = cell.currentEditor!;

			// A plain editor focus (no modifier) is the click-into-cell path: it
			// should enter edit mode and flag the cell editor as focused.
			await actAndSettle(() => editor.focus());

			expect({
				state: notebook.selectionStateMachine.state.get().type,
				cellEditorFocused: NotebookContextKeys.cellEditorFocused.getValue(editor.contextKeyService),
			}).toEqual({
				state: SelectionState.EditingSelection,
				cellEditorFocused: true,
			});
		});

		it('does not enter edit mode when the focus follows a modifier mousedown', async () => {
			const { notebook, cell } = await renderWidget();
			const editor = cell.currentEditor!;
			// Start from a clean single selection so the only edit-mode trigger
			// under test is the editor focus that follows the modifier mousedown.
			act(() => {
				notebook.selectionStateMachine.selectCell(cell, CellSelectionType.Normal);
			});

			// A shift/ctrl/cmd mousedown immediately before focus signals a
			// multi-select gesture; the focus handler must suppress edit mode.
			// The capture-phase native listener reads the modifier off mousedown.
			await actAndSettle(() => {
				editor.getContainerDomNode().dispatchEvent(
					new MouseEvent('mousedown', { bubbles: true, shiftKey: true }),
				);
				editor.focus();
			});

			expect({
				state: notebook.selectionStateMachine.state.get().type,
				cellEditorFocused: NotebookContextKeys.cellEditorFocused.getValue(editor.contextKeyService),
			}).toEqual({
				// Edit mode is suppressed: the modifier-focus branch only flags the
				// editor as focused and returns, leaving the selection where it was.
				// (Growing it to MultiSelection is the wrapper's onClick / Monaco
				// onMouseDown job, and is a no-op here anyway since this single-cell
				// notebook already has the only cell selected.)
				state: SelectionState.SingleSelection,
				cellEditorFocused: true,
			});
		});
	});

	describe('multi-select via modifier mousedown', () => {
		it('adds the cell to the selection on a modifier mousedown in its editor', async () => {
			const { notebook, cellA, cellB } = await renderTwoCellWidgetOnB();
			const editor = cellB.currentEditor!;

			// Seed a single selection on cell A so there is another selected cell
			// for cell B to join -- selectCell(Add) only grows to MultiSelection
			// when a different cell is already selected.
			act(() => {
				notebook.selectionStateMachine.selectCell(cellA, CellSelectionType.Normal);
			});

			// A shift-click inside cell B's editor flows through Monaco's mouse
			// pipeline and fires editor.onMouseDown, whose handler adds cell B to
			// the selection. (Monaco hit-tests the dispatched event against the
			// laid-out view, so lay the editor out first.)
			await actAndSettle(() => {
				editor.layout({ width: 400, height: 200 });
				editor.getDomNode()!.dispatchEvent(new MouseEvent('mousedown', {
					bubbles: true, cancelable: true, button: 0, buttons: 1, shiftKey: true,
					clientX: 10, clientY: 10,
				}));
			});

			const state = notebook.selectionStateMachine.state.get();
			expect({
				type: state.type,
				selected: state.type === SelectionState.MultiSelection ? state.selected : undefined,
				active: state.type === SelectionState.MultiSelection ? state.active : undefined,
			}).toEqual({
				type: SelectionState.MultiSelection,
				selected: [cellA, cellB],
				active: cellB,
			});
		});
	});

	describe('exit edit mode on editor blur', () => {
		it('exits edit mode when focus leaves to nothing', async () => {
			const { notebook, cell } = await renderWidget();
			const editor = cell.currentEditor!;

			// Enter edit mode via focus...
			await actAndSettle(() => editor.focus());
			expect(notebook.selectionStateMachine.state.get().type).toBe(SelectionState.EditingSelection);

			// ...then blur with nothing else taking focus: edit mode must exit.
			await actAndSettle(() => (document.activeElement as HTMLElement | null)?.blur());

			expect(notebook.selectionStateMachine.state.get().type).toBe(SelectionState.SingleSelection);
		});

		it('stays in edit mode when focus moves to a VS Code overlay', async () => {
			const { notebook, cell } = await renderWidget();
			const editor = cell.currentEditor!;

			await actAndSettle(() => editor.focus());

			// Simulate opening the command palette / quick pick from the editor:
			// focus moves to an element whose context carries inQuickOpen, which is
			// in the keep-edit-mode guard list. Edit mode must NOT exit.
			const overlay = document.createElement('input');
			document.body.appendChild(overlay);
			const overlayScope = ctx.reactServices.contextKeyService.createScoped(overlay);
			overlayScope.createKey(InQuickPickContextKey.key, true);

			await actAndSettle(() => overlay.focus());

			expect(notebook.selectionStateMachine.state.get().type).toBe(SelectionState.EditingSelection);

			overlayScope.dispose();
			overlay.remove();
		});

		it('stays in edit mode when focus moves elsewhere inside the notebook', async () => {
			const { notebook, cell } = await renderWidget();
			const editor = cell.currentEditor!;

			await actAndSettle(() => editor.focus());

			// Focus moves to another element still inside the notebook container
			// (e.g. a notebook toolbar button). Edit mode must persist.
			const sibling = document.createElement('input');
			notebook.currentContainer!.appendChild(sibling);

			await actAndSettle(() => sibling.focus());

			expect(notebook.selectionStateMachine.state.get().type).toBe(SelectionState.EditingSelection);

			sibling.remove();
		});
	});

	describe('focus restore on exit', () => {
		it('restores focus to the focus target when the cell has outputs', async () => {
			const { notebook, cell } = await renderWidget({ withOutputs: true });
			const editor = cell.currentEditor!;
			const target = screen.getByRole('button', { name: /edit cell/i });

			// Enter edit mode, then exit it programmatically (e.g. pressing Escape
			// elsewhere). With outputs, focus returns to the focus trap so keyboard
			// users land on the outputs region rather than losing their place.
			await actAndSettle(() => editor.focus());
			await actAndSettle(() => notebook.selectionStateMachine.exitEditor(cell));

			expect(target).toHaveFocus();
		});

		it('restores focus to the cell container when the cell has no outputs', async () => {
			const { notebook, cell } = await renderWidget({ withOutputs: false });
			const editor = cell.currentEditor!;

			// Without outputs the focus trap is out of the tab order, so focus
			// restoration targets the cell container instead.
			await actAndSettle(() => editor.focus());
			await actAndSettle(() => notebook.selectionStateMachine.exitEditor(cell));

			expect(cell.container).toHaveFocus();
		});
	});
});
