/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />
/// <reference types="@testing-library/jest-dom/vitest" />

import { URI } from '../../../../../base/common/uri.js';
import { Event } from '../../../../../base/common/event.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { createTextModel } from '../../../../../editor/test/common/testTextModel.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { EditorLayoutInfo, EditorMinimapLayoutInfo } from '../../../../../editor/common/config/editorOptions.js';
import { IManagedHover } from '../../../../../base/browser/ui/hover/hover.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { QuartoDocumentModel } from '../../browser/quartoDocumentModel.js';
import { QuartoCellToolbar } from '../../browser/quartoCellToolbar.js';
import { CellExecutionState } from '../../common/quartoExecutionTypes.js';

describe('QuartoCellToolbar - Position Updates', () => {
	const ctx = createTestContainer().build();
	const logService = new NullLogService();

	/**
	 * Test that verifies the document model fires appropriate events when cells move.
	 * This is a prerequisite for the toolbar controller to update positions correctly.
	 */
	describe('Document Model Events for Cell Movement', () => {

		it('inserting text between cells should update cell line numbers', async () => {
			// Create a document with two cells
			const content = `\`\`\`{python}
x = 1
\`\`\`

\`\`\`{python}
y = 2
\`\`\`
`;
			const textModel = createTextModel(content, null, undefined, URI.file('/test.qmd'));
			ctx.disposables.add(textModel);
			const model = new QuartoDocumentModel(textModel, logService);
			ctx.disposables.add(model);

			// Initial state: verify cell positions
			expect(model.cells.length).toBe(2);
			expect(model.cells[0].startLine).toBe(1);
			expect(model.cells[0].endLine).toBe(3);
			expect(model.cells[1].startLine).toBe(5);
			expect(model.cells[1].endLine).toBe(7);

			const originalCell1ContentHash = model.cells[1].contentHash;

			// Insert some lines between the two cells
			textModel.applyEdits([{
				range: {
					startLineNumber: 4,
					startColumn: 1,
					endLineNumber: 4,
					endColumn: 1
				},
				text: 'Some new text\nMore new text\n'
			}]);

			// Wait for debounce
			await new Promise(resolve => setTimeout(resolve, 150));

			// After insertion, the second cell should have moved down
			expect(model.cells.length).toBe(2);
			expect(model.cells[0].startLine, 'First cell start should not change').toBe(1);
			expect(model.cells[0].endLine, 'First cell end should not change').toBe(3);
			expect(model.cells[1].startLine, 'Second cell start should move down by 2 lines').toBe(7);
			expect(model.cells[1].endLine, 'Second cell end should move down by 2 lines').toBe(9);

			// Content hash should remain the same (content didn't change)
			expect(model.cells[1].contentHash).toBe(originalCell1ContentHash);

			// Note: The cell ID may or may not change depending on implementation
			// What matters is that the line numbers are updated
		});

		it('onDidParse should fire when cells move but content stays the same', async () => {
			const content = `\`\`\`{python}
x = 1
\`\`\`

\`\`\`{python}
y = 2
\`\`\`
`;
			const textModel = createTextModel(content, null, undefined, URI.file('/test.qmd'));
			ctx.disposables.add(textModel);
			const model = new QuartoDocumentModel(textModel, logService);
			ctx.disposables.add(model);

			let parseEventFired = false;
			ctx.disposables.add(model.onDidParse(() => {
				parseEventFired = true;
			}));

			// Insert text between cells (doesn't change cell content)
			textModel.applyEdits([{
				range: {
					startLineNumber: 4,
					startColumn: 1,
					endLineNumber: 4,
					endColumn: 1
				},
				text: 'Some new text\n'
			}]);

			// Wait for debounce
			await new Promise(resolve => setTimeout(resolve, 150));

			expect(parseEventFired, 'onDidParse should fire after text insertion').toBe(true);
		});

		it('onDidChangeCells does NOT fire when cells move without content change', async () => {
			const content = `\`\`\`{python}
x = 1
\`\`\`

\`\`\`{python}
y = 2
\`\`\`
`;
			const textModel = createTextModel(content, null, undefined, URI.file('/test.qmd'));
			ctx.disposables.add(textModel);
			const model = new QuartoDocumentModel(textModel, logService);
			ctx.disposables.add(model);

			let changeEventFired = false;
			ctx.disposables.add(model.onDidChangeCells(() => {
				changeEventFired = true;
			}));

			// Insert text between cells (doesn't change cell content)
			textModel.applyEdits([{
				range: {
					startLineNumber: 4,
					startColumn: 1,
					endLineNumber: 4,
					endColumn: 1
				},
				text: 'Some new text\n'
			}]);

			// Wait for debounce
			await new Promise(resolve => setTimeout(resolve, 150));

			// This is the key insight: onDidChangeCells does NOT fire when cells just move
			// The toolbar controller needs to also listen to onDidParse to update positions
			expect(changeEventFired, 'onDidChangeCells should NOT fire for position-only changes').toBe(false);

			// But the cells DO have updated positions
			expect(model.cells[1].startLine, 'Cell should have updated line numbers').toBe(6);
		});

		it('toolbar controller should update positions via onDidParse', async () => {
			// This test documents what the fix should achieve:
			// After inserting text between cells, the toolbar positions should update
			// even if cell content doesn't change

			const content = `\`\`\`{python}
x = 1
\`\`\`

\`\`\`{python}
y = 2
\`\`\`
`;
			const textModel = createTextModel(content, null, undefined, URI.file('/test.qmd'));
			ctx.disposables.add(textModel);
			const model = new QuartoDocumentModel(textModel, logService);
			ctx.disposables.add(model);

			// Track both events
			const eventsFired: string[] = [];
			ctx.disposables.add(model.onDidChangeCells(() => {
				eventsFired.push('onDidChangeCells');
			}));
			ctx.disposables.add(model.onDidParse(() => {
				eventsFired.push('onDidParse');
			}));

			// Record initial cell positions
			const initialPositions = model.cells.map(c => ({
				id: c.id,
				startLine: c.startLine
			}));

			// Insert text between cells
			textModel.applyEdits([{
				range: {
					startLineNumber: 4,
					startColumn: 1,
					endLineNumber: 4,
					endColumn: 1
				},
				text: 'New line 1\nNew line 2\nNew line 3\n'
			}]);

			// Wait for debounce
			await new Promise(resolve => setTimeout(resolve, 150));

			// onDidParse should always fire after parsing
			expect(eventsFired, 'onDidParse should fire after text changes').toContain('onDidParse');

			// The second cell should have moved
			const newPositions = model.cells.map(c => ({
				id: c.id,
				startLine: c.startLine
			}));

			// First cell unchanged
			expect(newPositions[0].startLine).toBe(initialPositions[0].startLine);

			// Second cell moved down by 3 lines
			expect(newPositions[1].startLine, 'Second cell should have moved down').toBe(initialPositions[1].startLine + 3);

			// The key insight: a toolbar controller listening to onDidParse
			// can refresh cell references and update positions correctly
		});
	});
});

describe('QuartoCellToolbar - Execution State DOM', () => {
	const ctx = createTestContainer().build();
	const logService = new NullLogService();

	const TWO_CELLS = `\`\`\`{python}
x = 1
\`\`\`

\`\`\`{python}
y = 2
\`\`\`
`;

	/**
	 * Build a toolbar for `cellIndex` of a two-cell document, along with the parsed
	 * cells so a test can re-point the toolbar at a different one.
	 */
	function createToolbar(cellIndex = 0) {
		const textModel = createTextModel(TWO_CELLS, null, undefined, URI.file('/test.qmd'));
		ctx.disposables.add(textModel);
		const model = new QuartoDocumentModel(textModel, logService);
		ctx.disposables.add(model);

		const editor = stubInterface<ICodeEditor>({
			addOverlayWidget: vi.fn(),
			removeOverlayWidget: vi.fn(),
			onDidScrollChange: Event.None,
			onDidLayoutChange: Event.None,
			getTopForLineNumber: () => 0,
			getScrollTop: () => 0,
			getLayoutInfo: () => stubInterface<EditorLayoutInfo>({
				height: 500,
				verticalScrollbarWidth: 10,
				minimap: stubInterface<EditorMinimapLayoutInfo>({ minimapWidth: 0 }),
			}),
			// `getOption` is generic over the option id, so a fixed line height can't
			// be expressed in its signature.
			getOption: (() => 18) as ICodeEditor['getOption'],
		});
		const hoverService = stubInterface<IHoverService>({
			setupManagedHover: () => stubInterface<IManagedHover>({ dispose: () => { } }),
		});
		const keybindingService = stubInterface<IKeybindingService>({ lookupKeybinding: () => undefined });

		const toolbar = new QuartoCellToolbar(
			editor, model.cells[cellIndex], cellIndex, model.cells.length,
			() => { }, () => { }, () => { }, () => { }, () => { }, () => { },
			hoverService, keybindingService
		);
		ctx.disposables.add(toolbar);

		return { toolbar, cells: model.cells, domNode: toolbar.getDomNode() };
	}

	it('retains the execution id after the run finishes', () => {
		const { toolbar, domNode } = createToolbar();

		toolbar.setExecutionState(CellExecutionState.Queued, 'quarto-exec-1');
		toolbar.setExecutionState(CellExecutionState.Running, 'quarto-exec-1');
		toolbar.setExecutionState(CellExecutionState.Completed, 'quarto-exec-1');

		// The queued/running button state is gone once the cell finishes, so the
		// retained id is the only durable evidence the run happened at all.
		expect(domNode).toHaveAttribute('data-execution-id', 'quarto-exec-1');
		expect(domNode).toHaveAttribute('data-execution-state', 'completed');
	});

	it('retains the execution id after the run errors', () => {
		const { toolbar, domNode } = createToolbar();

		toolbar.setExecutionState(CellExecutionState.Running, 'quarto-exec-err');
		toolbar.setExecutionState(CellExecutionState.Error, 'quarto-exec-err');

		// A cell that errors still registered a run, so the gate must see it --
		// otherwise a failing cell reads as a run that never dispatched.
		expect(domNode).toHaveAttribute('data-execution-id', 'quarto-exec-err');
		expect(domNode).toHaveAttribute('data-execution-state', 'error');
	});

	it('records a fresh execution id on a re-run of the same cell', () => {
		const { toolbar, domNode } = createToolbar();

		toolbar.setExecutionState(CellExecutionState.Completed, 'quarto-exec-1');
		toolbar.setExecutionState(CellExecutionState.Running, 'quarto-exec-2');

		expect(domNode).toHaveAttribute('data-execution-id', 'quarto-exec-2');
	});

	it('reports idle before any execution', () => {
		const { domNode } = createToolbar();

		expect(domNode).not.toHaveAttribute('data-execution-id');
		expect(domNode).toHaveAttribute('data-execution-state', 'idle');
	});

	it('drops the retained execution id when re-pointed at another cell', () => {
		const { toolbar, cells, domNode } = createToolbar();
		toolbar.setExecutionState(CellExecutionState.Completed, 'quarto-exec-1');

		toolbar.updateCell(cells[1], 1, cells.length);

		expect(domNode).not.toHaveAttribute('data-execution-id');
	});

	it('keeps the retained execution id when re-pointed at the same cell', () => {
		const { toolbar, cells, domNode } = createToolbar();
		toolbar.setExecutionState(CellExecutionState.Completed, 'quarto-exec-1');

		// Cell content is unchanged, so the toolbar is being reused rather than
		// reassigned -- the cell's last run still belongs to it.
		toolbar.updateCell(cells[0], 0, cells.length);

		expect(domNode).toHaveAttribute('data-execution-id', 'quarto-exec-1');
	});
});
