/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { CellEditType, CellKind } from '../../../notebook/common/notebookCommon.js';
import { POSITRON_NOTEBOOK_OUTPUT_IMAGE_TARGETED } from '../../browser/ContextKeysManager.js';
import { createTestPositronNotebookInstance, TestCellInput } from './testPositronNotebookInstance.js';
import { createTestContainer } from '../../../../test/browser/positronTestContainer.js';

function pngOutputItem() {
	// Minimal valid base64 PNG data
	return { mime: 'image/png', data: VSBuffer.fromString('iVBORw0KGgo=') };
}

function textOutputItem(text: string) {
	return { mime: 'application/vnd.code.notebook.stdout', data: VSBuffer.fromString(text) };
}

function svgOutputItem() {
	return { mime: 'image/svg+xml', data: VSBuffer.fromString('<svg><circle r="10"/></svg>') };
}

describe('Positron Notebook Cell Outputs', () => {
	// testPositronNotebookInstance creates its own instantiation service internally;
	// we only need the disposables from the container for cleanup.
	const ctx = createTestContainer().build();
	const disposables = ctx.disposables;

	describe('outputs observable', () => {
		it('cell with image output has parsed type "image"', () => {
			const cellWithImageOutput: TestCellInput = {
				source: 'plot()',
				language: 'python',
				mime: undefined,
				cellKind: CellKind.Code,
				outputs: [{
					outputId: 'output-1',
					outputs: [pngOutputItem()],
				}],
			};
			const notebook = createTestPositronNotebookInstance([cellWithImageOutput], disposables);
			const cell = notebook.cells.get()[0];

			expect(cell.isCodeCell()).toBeTruthy();
			const outputs = cell.outputs.get();
			expect(outputs.length).toBe(1);
			expect(outputs[0].parsed.type).toBe('image');
		});

		it('cell with text-only output has no image parsed outputs', () => {
			const cellWithTextOutput: TestCellInput = {
				source: 'print("hello")',
				language: 'python',
				mime: undefined,
				cellKind: CellKind.Code,
				outputs: [{
					outputId: 'output-1',
					outputs: [textOutputItem('hello')],
				}],
			};
			const notebook = createTestPositronNotebookInstance([cellWithTextOutput], disposables);
			const cell = notebook.cells.get()[0];

			expect(cell.isCodeCell()).toBeTruthy();
			const outputs = cell.outputs.get();
			expect(outputs.length).toBe(1);
			expect(outputs[0].parsed.type).toBe('stdout');
		});

		it('cell with SVG output has parsed type "image"', () => {
			const cellWithSvgOutput: TestCellInput = {
				source: 'plot()',
				language: 'python',
				mime: undefined,
				cellKind: CellKind.Code,
				outputs: [{
					outputId: 'output-1',
					outputs: [svgOutputItem()],
				}],
			};
			const notebook = createTestPositronNotebookInstance([cellWithSvgOutput], disposables);
			const cell = notebook.cells.get()[0];

			expect(cell.isCodeCell()).toBeTruthy();
			const outputs = cell.outputs.get();
			expect(outputs.length).toBe(1);
			expect(outputs[0].parsed.type).toBe('image');
		});

		it('adding image output to cell updates the outputs observable', () => {
			const notebook = createTestPositronNotebookInstance(
				[['print("hello")', 'python', CellKind.Code]],
				disposables
			);
			const cell = notebook.cells.get()[0];

			expect(cell.isCodeCell()).toBeTruthy();
			expect(cell.outputs.get().length).toBe(0);

			// Add an image output via the text model
			notebook.textModel!.applyEdits([{
				editType: CellEditType.Output,
				index: 0,
				outputs: [{
					outputId: 'new-output',
					outputs: [pngOutputItem()],
				}],
				append: false,
			}], true, undefined, () => undefined, undefined, false);

			const outputs = cell.outputs.get();
			expect(outputs.length).toBe(1);
			expect(outputs[0].parsed.type).toBe('image');
		});

		it('clearing outputs resets collapse state', () => {
			const notebook = createTestPositronNotebookInstance(
				[['print("hello")', 'python', CellKind.Code]],
				disposables
			);
			const cell = notebook.cells.get()[0];
			expect(cell.isCodeCell()).toBeTruthy();

			// Add output
			notebook.textModel!.applyEdits([{
				editType: CellEditType.Output,
				index: 0,
				outputs: [{ outputId: 'output-1', outputs: [textOutputItem('hello')] }],
				append: false,
			}], true, undefined, () => undefined, undefined, false);
			expect(cell.outputs.get().length).toBe(1);

			// Collapse the output
			cell.collapseOutput();
			expect(cell.outputIsCollapsed.get()).toBe(true);

			// Clear outputs
			notebook.clearCellOutput(cell);

			expect(cell.outputs.get().length).toBe(0);
			expect(cell.outputIsCollapsed.get()).toBe(false);
		});

		it('outputImageTargeted context key defaults to false and can be set', () => {
			const notebook = createTestPositronNotebookInstance(
				[['print("hello")', 'python', CellKind.Code]],
				disposables
			);

			const cellElement = document.createElement('div');
			const cellContextKeyService = notebook.scopedContextKeyService.createScoped(cellElement);
			disposables.add(cellContextKeyService);

			// Defaults to false
			expect(
				cellContextKeyService.getContextKeyValue(POSITRON_NOTEBOOK_OUTPUT_IMAGE_TARGETED.key)).toBe(undefined);

			// Can be bound and set to true (as the context menu handler does)
			const outputImageTargeted = POSITRON_NOTEBOOK_OUTPUT_IMAGE_TARGETED.bindTo(cellContextKeyService);
			outputImageTargeted.set(true);

			expect(
				cellContextKeyService.getContextKeyValue(POSITRON_NOTEBOOK_OUTPUT_IMAGE_TARGETED.key)).toBe(true);

			// Can be set back to false
			outputImageTargeted.set(false);
			expect(
				cellContextKeyService.getContextKeyValue(POSITRON_NOTEBOOK_OUTPUT_IMAGE_TARGETED.key)).toBe(false);
		});
	});
});
