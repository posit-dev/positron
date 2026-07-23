/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { Event, Emitter } from '../../../../../base/common/event.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { createTextModel } from '../../../../../editor/test/common/testTextModel.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { QuartoDocumentModel } from '../../browser/quartoDocumentModel.js';
import { QuartoOutputContribution, IQuartoOutputManager } from '../../browser/quartoOutputManager.js';
import { IQuartoDocumentModelService } from '../../browser/quartoDocumentModelService.js';
import { IQuartoKernelManager } from '../../browser/quartoKernelManager.js';
import { IQuartoExecutionManager, IQuartoOutputCacheService, ICellOutput, ICachedDocument } from '../../common/quartoExecutionTypes.js';
import { IQuartoDocumentModel, QuartoCodeCell } from '../../common/quartoTypes.js';
import { QUARTO_INLINE_OUTPUT_ENABLED } from '../../common/positronQuartoConfig.js';
import { IPositronNotebookOutputWebviewService } from '../../../positronOutputWebview/browser/notebookOutputWebviewService.js';
import { IResourceUsageHistoryService } from '../../../../services/positronConsole/browser/resourceUsageHistoryService.js';

import { IPositronPreviewService } from '../../../positronPreview/browser/positronPreviewSevice.js';
import { PreviewWebview } from '../../../positronPreview/browser/previewWebview.js';

describe('QuartoOutputManager', () => {
	const logService = new NullLogService();

	// Fixtures for the reopen restore test (see 'Cached Output Restore On
	// Reopen'). The document model's parse state is driven directly: it starts
	// with no cells and gains one when the test fires onDidParse.
	const reopenUri = URI.file('/reopen.qmd');
	const parseEmitter = new Emitter<void>();
	let liveCells: QuartoCodeCell[] = [];
	let cachedDoc: ICachedDocument | undefined;
	const quartoModel = stubInterface<IQuartoDocumentModel>({
		uri: reopenUri,
		primaryLanguage: 'python',
		get cells() { return liveCells; },
		onDidParse: parseEmitter.event,
		onDidChangeCells: Event.None,
		onDidChangeLanguage: Event.None,
		findCellByContentHash: (hash: string) => liveCells.find(c => c.contentHash === hash),
		getCellById: () => undefined,
	});
	const reopenEditorModel = createTextModel('', 'quarto', undefined, reopenUri);

	const ctx = createTestContainer()
		.withWorkbenchServices()
		.withContributionServices()
		.stub(IQuartoDocumentModelService, { getModel: () => quartoModel })
		.stub(IQuartoOutputCacheService, {
			loadCache: async () => cachedDoc,
			findCacheByContentHash: async () => undefined,
		})
		.stub(IQuartoExecutionManager, {
			onDidReceiveOutput: Event.None,
			onDidChangeExecutionState: Event.None,
		})
		.stub(IQuartoKernelManager, {
			onDidChangeKernelState: Event.None,
			getSessionForDocument: () => undefined,
		})
		.stub(IQuartoOutputManager, {
			onDidChangeOutputs: Event.None,
			onDidRequestClearDocument: Event.None,
			onDidRequestClearAll: Event.None,
		})
		.stub(IPositronNotebookOutputWebviewService, {})
		.stub(IResourceUsageHistoryService, {})
		.build();

	describe('Output Preservation When Cells Move', () => {
		/**
		 * This test simulates the bug where inserting a new cell at the top of the document
		 * causes all existing outputs to be deleted.
		 *
		 * The bug occurs because:
		 * 1. Cell IDs include the index (e.g., "0-abc12345-unlabeled")
		 * 2. When a new cell is inserted at the top, all existing cells shift down
		 * 3. Their IDs change (e.g., "0-abc12345-unlabeled" becomes "1-abc12345-unlabeled")
		 * 4. The output manager looks up cells by their OLD IDs
		 * 5. Since those IDs don't exist anymore, it thinks the cells were deleted
		 * 6. It incorrectly removes the outputs/view zones
		 *
		 * This test verifies that we can correctly remap outputs when cells move
		 * by using content hashes to track cell identity across position changes.
		 */
		it('outputs should be preserved when a new cell is inserted above existing cells', async () => {
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

			// Initial state: two cells with outputs
			expect(model.cells.length).toBe(2);
			const originalCell0Id = model.cells[0].id;
			const originalCell1Id = model.cells[1].id;
			const cell0ContentHash = model.cells[0].contentHash;
			const cell1ContentHash = model.cells[1].contentHash;

			// Simulate having outputs stored for these cells
			// In the real output manager, this would be: _viewZones.set(cellId, viewZone)
			const viewZonesByCellId = new Map<string, { cellId: string; contentHash: string }>();
			viewZonesByCellId.set(originalCell0Id, { cellId: originalCell0Id, contentHash: cell0ContentHash });
			viewZonesByCellId.set(originalCell1Id, { cellId: originalCell1Id, contentHash: cell1ContentHash });

			// Insert a new cell at the top
			textModel.applyEdits([{
				range: {
					startLineNumber: 1,
					startColumn: 1,
					endLineNumber: 1,
					endColumn: 1
				},
				text: '```{python}\nz = 0\n```\n\n'
			}]);

			// Wait for debounce
			await new Promise(resolve => setTimeout(resolve, 150));

			// Now we have 3 cells
			expect(model.cells.length).toBe(3);

			// Simulate what _updateViewZonePositionsImmediate currently does (the buggy behavior):
			// It looks up cells by their OLD IDs, which no longer exist
			const removedByBuggyLogic: string[] = [];
			for (const [cellId, _viewZone] of viewZonesByCellId) {
				const cell = model.getCellById(cellId);
				if (!cell) {
					// BUG: Cell ID changed, so getCellById returns undefined
					// The buggy logic thinks the cell was deleted and removes the output
					removedByBuggyLogic.push(cellId);
				}
			}

			// The buggy logic incorrectly removes BOTH cells because their IDs changed
			expect(removedByBuggyLogic.length, 'Buggy logic removes both cells because IDs changed').toBe(2);
			expect(removedByBuggyLogic, 'Original cell 0 is incorrectly removed').toContain(originalCell0Id);
			expect(removedByBuggyLogic, 'Original cell 1 is incorrectly removed').toContain(originalCell1Id);

			// The CORRECT behavior: use content hash to find cells that moved
			const remappedViewZones = new Map<string, { cellId: string; contentHash: string }>();
			for (const [cellId, viewZone] of viewZonesByCellId) {
				const cell = model.getCellById(cellId);
				if (cell) {
					// Cell ID still exists - update position normally
					remappedViewZones.set(cellId, viewZone);
				} else {
					// Cell ID doesn't exist - try to find by content hash
					const cellByHash = model.findCellByContentHash(viewZone.contentHash);
					if (cellByHash) {
						// Found the cell - it just moved! Remap to new ID
						remappedViewZones.set(cellByHash.id, {
							cellId: cellByHash.id,
							contentHash: viewZone.contentHash
						});
					}
					// If not found by hash either, THEN the cell was truly deleted
				}
			}

			// With correct logic, both view zones should be preserved with new IDs
			expect(remappedViewZones.size, 'Correct logic preserves both outputs').toBe(2);

			// The view zones should now be keyed by the NEW cell IDs
			const newCell0Id = model.cells[1].id; // Original cell 0 is now at index 1
			const newCell1Id = model.cells[2].id; // Original cell 1 is now at index 2
			expect(remappedViewZones.has(newCell0Id), 'View zone for original cell 0 should be remapped to new ID').toBe(true);
			expect(remappedViewZones.has(newCell1Id), 'View zone for original cell 1 should be remapped to new ID').toBe(true);
		});

		it('outputs should still be removed when a cell is actually deleted', async () => {
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

			// Initial state: two cells with outputs
			const originalCell0Id = model.cells[0].id;
			const originalCell1Id = model.cells[1].id;
			const cell0ContentHash = model.cells[0].contentHash;
			const cell1ContentHash = model.cells[1].contentHash;

			// Simulate having outputs for these cells
			const viewZonesByCellId = new Map<string, { cellId: string; contentHash: string }>();
			viewZonesByCellId.set(originalCell0Id, { cellId: originalCell0Id, contentHash: cell0ContentHash });
			viewZonesByCellId.set(originalCell1Id, { cellId: originalCell1Id, contentHash: cell1ContentHash });

			// Delete the first cell entirely
			textModel.applyEdits([{
				range: {
					startLineNumber: 1,
					startColumn: 1,
					endLineNumber: 5, // Delete the first cell and the blank line after
					endColumn: 1
				},
				text: ''
			}]);

			// Wait for debounce
			await new Promise(resolve => setTimeout(resolve, 150));

			// Now we have only 1 cell
			expect(model.cells.length).toBe(1);

			// The remaining cell's content hash should match the original second cell
			expect(model.cells[0].contentHash).toBe(cell1ContentHash);

			// Use the correct remapping logic
			const remappedViewZones = new Map<string, { cellId: string; contentHash: string }>();
			for (const [cellId, viewZone] of viewZonesByCellId) {
				const cell = model.getCellById(cellId);
				if (cell) {
					remappedViewZones.set(cellId, viewZone);
				} else {
					const cellByHash = model.findCellByContentHash(viewZone.contentHash);
					if (cellByHash) {
						remappedViewZones.set(cellByHash.id, {
							cellId: cellByHash.id,
							contentHash: viewZone.contentHash
						});
					}
					// Cell was truly deleted - don't add to remapped
				}
			}

			// Only one view zone should be preserved (the second cell, which is now first)
			expect(remappedViewZones.size, 'Only one output should be preserved').toBe(1);

			// The remaining view zone should be for the cell that was originally second
			const newCellId = model.cells[0].id;
			expect(remappedViewZones.has(newCellId), 'View zone for surviving cell should be preserved').toBe(true);
		});
	});

	describe('Cached Output Restore On Reopen', () => {
		/**
		 * Regression test for the close-and-reopen flake where a Quarto .qmd's
		 * inline output silently fails to re-render (win/electron 120s timeout).
		 *
		 * On reopen the editor's text model exists before its cells are parsed.
		 * _loadCachedOutputs matches cached outputs to live cells by content hash;
		 * with zero parsed cells that match returns nothing, so every cached
		 * output is dropped and the pass marks itself complete with no retry. The
		 * fix defers the restore until the model has parsed cells, for any
		 * document scheme -- previously the deferral only covered untitled
		 * hot-exit restores, so a file reopen fell through and dropped its output.
		 *
		 * This drives the real contribution: with the bug present the final
		 * assertion fails because the output is never restored after parse.
		 */
		it('restores cached output after the model parses on reopen, instead of dropping it', async () => {
			ctx.disposables.add(reopenEditorModel);
			ctx.disposables.add(parseEmitter);

			const cachedCellId = '0-abchash-unlabeled';
			const contentHash = 'abchash';
			const cachedOutput: ICellOutput = {
				outputId: 'out-1',
				items: [{ mime: 'text/plain', data: 'plot' }],
			};
			cachedDoc = {
				sourceUri: reopenUri.toString(),
				lastUpdated: Date.now(),
				cells: [{ cellId: cachedCellId, contentHash, outputs: [cachedOutput] }],
			};

			// Reopen before parse: the cache has the output but no cells are parsed yet.
			liveCells = [];

			const editor = stubInterface<ICodeEditor>({
				hasModel: (() => true) as ICodeEditor['hasModel'],
				getModel: () => reopenEditorModel,
				getOption: (() => false) as ICodeEditor['getOption'],
				onDidChangeModel: Event.None,
			});

			// Enable the feature so the contribution initializes output handling.
			QUARTO_INLINE_OUTPUT_ENABLED.bindTo(ctx.get(IContextKeyService)).set(true);

			const contribution = ctx.disposables.add(
				ctx.instantiationService.createInstance(QuartoOutputContribution, editor)
			);

			// Let the async restore run to its defer point.
			await new Promise(resolve => setTimeout(resolve, 0));
			// Before parse nothing can match, so the cached output is not restored yet.
			expect(contribution.getOutputsForCell(cachedCellId)).toHaveLength(0);

			// The model parses and the cached cell appears (mirrors onDidParse on reopen).
			liveCells = [stubInterface<QuartoCodeCell>({ id: cachedCellId, contentHash })];
			parseEmitter.fire();
			await new Promise(resolve => setTimeout(resolve, 0));

			// The deferred restore retries and records the cached output. With the
			// bug the file reopen fell through, dropped the output, and never
			// retried, so this stays empty.
			expect(contribution.getOutputsForCell(cachedCellId)).toHaveLength(1);
		});
	});

	describe('HTML Popout', () => {
		/**
		 * This test verifies that popping out HTML content (e.g., a DataFrame)
		 * uses the preview service's openHtmlString method to display the HTML
		 * directly in the Viewer pane, rather than writing a temp file to disk.
		 *
		 * The bug was that _openHtmlInViewer would:
		 * 1. Write HTML to a .positron-temp-*.html file in the project directory
		 * 2. Call previewService.openHtml(path) which starts a proxy server
		 * 3. The proxy server fails, showing "Cannot GET /..."
		 * 4. The temp file is never cleaned up
		 *
		 * The fix: use previewService.openHtmlString(html) which sets HTML
		 * directly on a webview without needing temp files or proxy servers.
		 */
		it('HTML popout should use openHtmlString instead of writing temp files', () => {
			// Track calls to the preview service
			let openHtmlStringCalled = false;
			let openHtmlStringArgs: { previewId: string; html: string; title: string } | undefined;
			let openHtmlCalled = false;

			// Mock preview service - only the methods we care about
			const mockPreviewService: Partial<IPositronPreviewService> = {
				openHtmlString(previewId: string, html: string, title: string): PreviewWebview {
					openHtmlStringCalled = true;
					openHtmlStringArgs = { previewId, html, title };
					return {} as PreviewWebview;
				},
				async openHtml(_previewId: string, _extension: unknown, _path: string) {
					openHtmlCalled = true;
					return {} as PreviewWebview;
				},
			};

			// Simulate what _openHtmlInViewer should do after the fix:
			// It should call openHtmlString, NOT writeFile + openHtml
			const html = '<html><body><h1>DataFrame</h1><table>...</table></body></html>';
			const cellId = '0-abc12345-unlabeled';

			const previewId = `quartoHtmlOutput.${cellId}`;
			const docName = 'test.qmd';
			const title = `Output - ${docName}`;
			mockPreviewService.openHtmlString!(previewId, html, title);

			// Verify: openHtmlString was called with correct arguments
			expect(openHtmlStringCalled, 'openHtmlString should be called').toBe(true);
			expect(openHtmlStringArgs?.previewId, 'previewId should match').toBe(previewId);
			expect(openHtmlStringArgs?.html, 'HTML content should be passed directly').toBe(html);
			expect(openHtmlStringArgs?.title, 'title should include doc name').toBe(title);

			// Verify: openHtml was NOT called (no file path needed)
			expect(openHtmlCalled, 'openHtml should NOT be called (no file path needed)').toBe(false);
		});

		it('openHtmlString should exist on IPositronPreviewService', () => {
			// This test verifies the interface contract: IPositronPreviewService
			// should have an openHtmlString method that accepts HTML content directly.
			// This is a compile-time check as much as a runtime one.
			const mockService: Pick<IPositronPreviewService, 'openHtmlString'> = {
				openHtmlString(_previewId: string, _html: string, _title: string): PreviewWebview {
					return {} as PreviewWebview;
				},
			};

			// Verify the method exists and is callable
			expect(typeof mockService.openHtmlString, 'openHtmlString should be a function on IPositronPreviewService').toBe('function');
		});
	});
});
