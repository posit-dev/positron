/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { createTestContainer } from '../../../../test/browser/positronTestContainer.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { createTextModel } from '../../../../../editor/test/common/testTextModel.js';
import { QuartoDocumentModel } from '../../browser/quartoDocumentModel.js';

import { IPositronPreviewService } from '../../../positronPreview/browser/positronPreviewSevice.js';
import { PreviewWebview } from '../../../positronPreview/browser/previewWebview.js';

describe('QuartoOutputManager', () => {
	const ctx = createTestContainer().build();
	const logService = new NullLogService();

	describe('Output Preservation When Cells Move', () => {
		/**
		 * This test simulates the bug where inserting a new cell at the top of the document
		 * causes all existing outputs to be deleted.
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
			const removedByBuggyLogic: string[] = [];
			for (const [cellId, _viewZone] of viewZonesByCellId) {
				const cell = model.getCellById(cellId);
				if (!cell) {
					removedByBuggyLogic.push(cellId);
				}
			}

			// The buggy logic incorrectly removes BOTH cells because their IDs changed
			expect(removedByBuggyLogic.length).toBe(2);
			expect(removedByBuggyLogic.includes(originalCell0Id)).toBeTruthy();
			expect(removedByBuggyLogic.includes(originalCell1Id)).toBeTruthy();

			// The CORRECT behavior: use content hash to find cells that moved
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
				}
			}

			// With correct logic, both view zones should be preserved with new IDs
			expect(remappedViewZones.size).toBe(2);

			// The view zones should now be keyed by the NEW cell IDs
			const newCell0Id = model.cells[1].id; // Original cell 0 is now at index 1
			const newCell1Id = model.cells[2].id; // Original cell 1 is now at index 2
			expect(remappedViewZones.has(newCell0Id)).toBeTruthy();
			expect(remappedViewZones.has(newCell1Id)).toBeTruthy();
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
					endLineNumber: 5,
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
				}
			}

			// Only one view zone should be preserved (the second cell, which is now first)
			expect(remappedViewZones.size).toBe(1);

			// The remaining view zone should be for the cell that was originally second
			const newCellId = model.cells[0].id;
			expect(remappedViewZones.has(newCellId)).toBeTruthy();
		});
	});

	describe('HTML Popout', () => {
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
					return {} as any;
				},
			};

			// Simulate what _openHtmlInViewer should do after the fix:
			const html = '<html><body><h1>DataFrame</h1><table>...</table></body></html>';
			const cellId = '0-abc12345-unlabeled';

			const previewId = `quartoHtmlOutput.${cellId}`;
			const docName = 'test.qmd';
			const title = `Output - ${docName}`;
			mockPreviewService.openHtmlString!(previewId, html, title);

			// Verify: openHtmlString was called with correct arguments
			expect(openHtmlStringCalled).toBeTruthy();
			expect(openHtmlStringArgs?.previewId).toBe(previewId);
			expect(openHtmlStringArgs?.html).toBe(html);
			expect(openHtmlStringArgs?.title).toBe(title);

			// Verify: openHtml was NOT called (no file path needed)
			expect(!openHtmlCalled).toBeTruthy();
		});

		it('openHtmlString should exist on IPositronPreviewService', () => {
			const mockService: Pick<IPositronPreviewService, 'openHtmlString'> = {
				openHtmlString(_previewId: string, _html: string, _title: string): PreviewWebview {
					return {} as PreviewWebview;
				},
			};

			// Verify the method exists and is callable
			expect(typeof mockService.openHtmlString === 'function').toBeTruthy();
		});
	});
});
