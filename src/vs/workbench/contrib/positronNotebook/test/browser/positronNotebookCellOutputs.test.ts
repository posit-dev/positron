/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { CellEditType, CellKind } from '../../../notebook/common/notebookCommon.js';
import { createTestPositronNotebookInstance, TestCellInput } from './testPositronNotebookInstance.js';

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

suite('Positron Notebook Cell Outputs', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	suite('outputs observable', () => {
		test('cell with image output has parsed type "image"', () => {
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

			assert.ok(cell.isCodeCell(), 'cell should be a code cell');
			const outputs = cell.outputs.get();
			assert.strictEqual(outputs.length, 1);
			assert.strictEqual(outputs[0].parsed.type, 'image');
		});

		test('cell with text-only output has no image parsed outputs', () => {
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

			assert.ok(cell.isCodeCell());
			const outputs = cell.outputs.get();
			assert.strictEqual(outputs.length, 1);
			assert.strictEqual(outputs[0].parsed.type, 'stdout');
		});

		test('cell with SVG output has parsed type "image"', () => {
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

			assert.ok(cell.isCodeCell());
			const outputs = cell.outputs.get();
			assert.strictEqual(outputs.length, 1);
			assert.strictEqual(outputs[0].parsed.type, 'image');
		});

		test('adding image output to cell updates the outputs observable', () => {
			const notebook = createTestPositronNotebookInstance(
				[['print("hello")', 'python', CellKind.Code]],
				disposables
			);
			const cell = notebook.cells.get()[0];

			assert.ok(cell.isCodeCell());
			assert.strictEqual(cell.outputs.get().length, 0, 'cell should start with no outputs');

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
			assert.strictEqual(outputs.length, 1, 'cell should have one output after edit');
			assert.strictEqual(outputs[0].parsed.type, 'image');
		});

		test('hasImageOutput check works on parsed outputs', () => {
			const cellWithMixedOutputs: TestCellInput = {
				source: 'display()',
				language: 'python',
				mime: undefined,
				cellKind: CellKind.Code,
				outputs: [
					{
						outputId: 'output-text',
						outputs: [textOutputItem('some text')],
					},
					{
						outputId: 'output-image',
						outputs: [pngOutputItem()],
					},
				],
			};
			const notebook = createTestPositronNotebookInstance([cellWithMixedOutputs], disposables);
			const cell = notebook.cells.get()[0];

			assert.ok(cell.isCodeCell());
			const outputs = cell.outputs.get();
			assert.strictEqual(outputs.length, 2);

			// This is the same check used by the context key in useCellContextKeys.ts
			const hasImageOutput = outputs.some(o => o.parsed.type === 'image');
			assert.ok(hasImageOutput, 'should detect image output among mixed outputs');
		});
	});
});
