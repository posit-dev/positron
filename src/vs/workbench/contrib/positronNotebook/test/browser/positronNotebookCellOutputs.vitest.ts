/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { CellEditType, CellKind } from '../../../notebook/common/notebookCommon.js';
import { CellContextKeys } from '../../common/cellContextKeys.js';
import { hasWebviewOutput } from '../../browser/PositronNotebookCells/notebookOutputUtils.js';
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

function jsonOutputItem(data: unknown) {
	return { mime: 'application/json', data: VSBuffer.fromString(JSON.stringify(data)) };
}

function invalidJsonOutputItem() {
	return { mime: 'application/json', data: VSBuffer.fromString('{not valid json') };
}

describe('Positron Notebook Cell Outputs', () => {
	const ctx = createTestContainer().withNotebookEditorServices().build();

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
			const notebook = createTestPositronNotebookInstance([cellWithImageOutput], ctx);
			const cell = notebook.cells.get()[0];

			expect(cell.isCodeCell(), 'cell should be a code cell').toBe(true);
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
			const notebook = createTestPositronNotebookInstance([cellWithTextOutput], ctx);
			const cell = notebook.cells.get()[0];

			expect(cell.isCodeCell()).toBe(true);
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
			const notebook = createTestPositronNotebookInstance([cellWithSvgOutput], ctx);
			const cell = notebook.cells.get()[0];

			expect(cell.isCodeCell()).toBe(true);
			const outputs = cell.outputs.get();
			expect(outputs.length).toBe(1);
			expect(outputs[0].parsed.type).toBe('image');
		});

		it('adding image output to cell updates the outputs observable', () => {
			const notebook = createTestPositronNotebookInstance(
				[['print("hello")', 'python', CellKind.Code]],
				ctx
			);
			const cell = notebook.cells.get()[0];

			expect(cell.isCodeCell()).toBe(true);
			expect(cell.outputs.get().length, 'cell should start with no outputs').toBe(0);

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
			expect(outputs.length, 'cell should have one output after edit').toBe(1);
			expect(outputs[0].parsed.type).toBe('image');
		});

		it('clearing outputs resets collapse state', () => {
			const notebook = createTestPositronNotebookInstance(
				[['print("hello")', 'python', CellKind.Code]],
				ctx
			);
			const cell = notebook.cells.get()[0];
			expect(cell.isCodeCell()).toBe(true);

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
			expect(cell.outputIsCollapsed.get(), 'collapse state should reset when outputs are cleared').toBe(false);
		});

		it('outputImageTargeted context key defaults to false and can be set', () => {
			const notebook = createTestPositronNotebookInstance(
				[['print("hello")', 'python', CellKind.Code]],
				ctx
			);

			const cellElement = document.createElement('div');
			const cellContextKeyService = notebook.scopedContextKeyService.createScoped(cellElement);
			ctx.disposables.add(cellContextKeyService);

			// Defaults to false
			expect(
				cellContextKeyService.getContextKeyValue(CellContextKeys.outputImageTargeted.key),
				'outputImageTargeted should not be set by default'
			).toBe(undefined);

			// Can be bound and set to true (as the context menu handler does)
			const outputImageTargeted = CellContextKeys.outputImageTargeted.bindTo(cellContextKeyService);
			outputImageTargeted.set(true);

			expect(
				cellContextKeyService.getContextKeyValue(CellContextKeys.outputImageTargeted.key),
				'outputImageTargeted should be true after being set'
			).toBe(true);

			// Can be set back to false
			outputImageTargeted.set(false);
			expect(
				cellContextKeyService.getContextKeyValue(CellContextKeys.outputImageTargeted.key),
				'outputImageTargeted should be false after being cleared'
			).toBe(false);
		});

	});

	describe('JSON output', () => {
		it('cell with application/json output has parsed type "json"', () => {
			const cellWithJsonOutput: TestCellInput = {
				source: 'JSON({"x": 1})',
				language: 'python',
				mime: undefined,
				cellKind: CellKind.Code,
				outputs: [{
					outputId: 'output-1',
					outputs: [jsonOutputItem({ x: 1, y: [2, 3], nested: { flag: true } })],
				}],
			};
			const notebook = createTestPositronNotebookInstance([cellWithJsonOutput], ctx);
			const cell = notebook.cells.get()[0];

			expect(cell.isCodeCell()).toBe(true);
			const outputs = cell.outputs.get();
			expect(outputs.length).toBe(1);
			expect(outputs[0].parsed.type).toBe('json');
			if (outputs[0].parsed.type === 'json') {
				expect(outputs[0].parsed.data).toEqual({ x: 1, y: [2, 3], nested: { flag: true } });
			}
		});

		it('invalid JSON falls back to text output', () => {
			const cellWithInvalidJson: TestCellInput = {
				source: 'display_json()',
				language: 'python',
				mime: undefined,
				cellKind: CellKind.Code,
				outputs: [{
					outputId: 'output-1',
					outputs: [invalidJsonOutputItem()],
				}],
			};
			const notebook = createTestPositronNotebookInstance([cellWithInvalidJson], ctx);
			const cell = notebook.cells.get()[0];

			expect(cell.isCodeCell()).toBe(true);
			const outputs = cell.outputs.get();
			expect(outputs.length).toBe(1);
			expect(outputs[0].parsed.type).toBe('text');
		});
	});

	describe('complex HTML routing', () => {
		function complexHtmlOutputItem() {
			return { mime: 'text/html', data: VSBuffer.fromString('<html><body><iframe src="map.html"></iframe></body></html>') };
		}

		function simpleHtmlOutputItem() {
			return { mime: 'text/html', data: VSBuffer.fromString('<p>Hello world</p>') };
		}

		function inertFullDocumentOutputItem() {
			// A full HTML document with styles but no active content (no scripts or
			// iframes), e.g. Great Tables output. Must render inline, not in a webview.
			return { mime: 'text/html', data: VSBuffer.fromString('<!DOCTYPE html><html><head><style>table { color: red; }</style></head><body><table><tr><td>1</td></tr></table></body></html>') };
		}

		it('complex HTML output produces a preloadMessageResult with display type', () => {
			const cellWithComplexHtml: TestCellInput = {
				source: 'display_map()',
				language: 'python',
				mime: undefined,
				cellKind: CellKind.Code,
				outputs: [{
					outputId: 'output-1',
					outputs: [complexHtmlOutputItem()],
				}],
			};
			const notebook = createTestPositronNotebookInstance([cellWithComplexHtml], ctx);
			const cell = notebook.cells.get()[0];

			expect(cell.isCodeCell(), 'cell should be a code cell').toBe(true);
			const outputs = cell.outputs.get();
			expect(outputs.length).toBe(1);
			expect(outputs[0].preloadMessageResult, 'should have a preloadMessageResult').toBeDefined();
			expect(outputs[0].preloadMessageResult!.preloadMessageType).toBe('display');
		});

		it('simple HTML output renders inline without preloadMessageResult', () => {
			const cellWithSimpleHtml: TestCellInput = {
				source: 'display_html()',
				language: 'python',
				mime: undefined,
				cellKind: CellKind.Code,
				outputs: [{
					outputId: 'output-1',
					outputs: [simpleHtmlOutputItem()],
				}],
			};
			const notebook = createTestPositronNotebookInstance([cellWithSimpleHtml], ctx);
			const cell = notebook.cells.get()[0];

			expect(cell.isCodeCell()).toBe(true);
			const outputs = cell.outputs.get();
			expect(outputs.length).toBe(1);
			expect(outputs[0].preloadMessageResult, 'simple HTML should not have preloadMessageResult').toBe(undefined);
			expect(outputs[0].parsed.type).toBe('html');
		});

		it('inert full-document HTML renders inline without a webview', () => {
			const cellWithFullDocument: TestCellInput = {
				source: 'GT(df)',
				language: 'python',
				mime: undefined,
				cellKind: CellKind.Code,
				outputs: [{
					outputId: 'output-1',
					outputs: [inertFullDocumentOutputItem()],
				}],
			};
			const notebook = createTestPositronNotebookInstance([cellWithFullDocument], ctx);
			const cell = notebook.cells.get()[0];

			expect(cell.isCodeCell()).toBe(true);
			const outputs = cell.outputs.get();
			expect(outputs.length).toBe(1);
			expect(outputs[0].preloadMessageResult, 'an inert full document must not route to a webview').toBe(undefined);
			expect(outputs[0].parsed.type).toBe('html');
		});

		it('hasWebviewOutput is true for a webview output and false for an inline output', () => {
			const webviewCell: TestCellInput = {
				source: 'display_map()',
				language: 'python',
				mime: undefined,
				cellKind: CellKind.Code,
				outputs: [{ outputId: 'output-1', outputs: [complexHtmlOutputItem()] }],
			};
			const webviewNotebook = createTestPositronNotebookInstance([webviewCell], ctx);
			expect(hasWebviewOutput(webviewNotebook.cells.get()[0].outputs.get())).toBe(true);

			const inlineCell: TestCellInput = {
				source: 'GT(df)',
				language: 'python',
				mime: undefined,
				cellKind: CellKind.Code,
				outputs: [{ outputId: 'output-1', outputs: [inertFullDocumentOutputItem()] }],
			};
			const inlineNotebook = createTestPositronNotebookInstance([inlineCell], ctx);
			expect(hasWebviewOutput(inlineNotebook.cells.get()[0].outputs.get())).toBe(false);
		});
	});

	// Model-level coverage for the Collapse Output, Show Hidden Output (expand),
	// and Clear Output cell actions (#12411). The action handlers in
	// `positronNotebook.contribution.ts` delegate to these cell/instance methods,
	// and their menu visibility is driven by the context keys asserted below.
	describe('output visibility and clear actions (#12411)', () => {
		function cellWithOutputs(...outputs: { mime: string; data: VSBuffer }[][]): TestCellInput {
			return {
				source: 'print("hello")',
				language: 'python',
				mime: undefined,
				cellKind: CellKind.Code,
				outputs: outputs.map((items, i) => ({
					outputId: `output-${i + 1}`,
					outputs: items,
				})),
			};
		}

		// Narrowing accessor: expect(cell.isCodeCell()).toBe(true) does not
		// narrow the union type, so output members would not typecheck.
		function firstCodeCell(notebook: ReturnType<typeof createTestPositronNotebookInstance>) {
			const cell = notebook.cells.get()[0];
			if (!cell.isCodeCell()) {
				throw new Error('expected a code cell');
			}
			return cell;
		}

		it('collapse output hides the output without deleting it', () => {
			const notebook = createTestPositronNotebookInstance(
				[cellWithOutputs([textOutputItem('hello')])],
				ctx
			);
			const cell = firstCodeCell(notebook);
			expect(cell.outputIsCollapsed.get(), 'output should start expanded').toBe(false);

			cell.collapseOutput();

			expect(cell.outputIsCollapsed.get()).toBe(true);
			const outputs = cell.outputs.get();
			expect(outputs.length, 'collapse is visibility-only; outputs must survive').toBe(1);
			expect(outputs[0].parsed.type).toBe('stdout');
		});

		it('show hidden output (expand) restores visibility with outputs intact', () => {
			const notebook = createTestPositronNotebookInstance(
				[cellWithOutputs([textOutputItem('hello')])],
				ctx
			);
			const cell = firstCodeCell(notebook);

			cell.collapseOutput();
			expect(cell.outputIsCollapsed.get()).toBe(true);

			cell.expandOutput();

			expect(cell.outputIsCollapsed.get()).toBe(false);
			const outputs = cell.outputs.get();
			expect(outputs.length, 'outputs must be unchanged after a collapse/expand cycle').toBe(1);
			expect(outputs[0].parsed.type).toBe('stdout');
		});

		it('toggleOutputCollapse flips the collapse state', () => {
			const notebook = createTestPositronNotebookInstance(
				[cellWithOutputs([textOutputItem('hello')])],
				ctx
			);
			const cell = firstCodeCell(notebook);

			cell.toggleOutputCollapse();
			expect(cell.outputIsCollapsed.get()).toBe(true);

			cell.toggleOutputCollapse();
			expect(cell.outputIsCollapsed.get()).toBe(false);
		});

		it('collapse state initializes from cell collapseState metadata', () => {
			const collapsedCell: TestCellInput = {
				source: 'print("hello")',
				language: 'python',
				mime: undefined,
				cellKind: CellKind.Code,
				outputs: [{ outputId: 'output-1', outputs: [textOutputItem('hello')] }],
				collapseState: { outputCollapsed: true },
			};
			const notebook = createTestPositronNotebookInstance([collapsedCell], ctx);
			const cell = firstCodeCell(notebook);

			expect(
				cell.outputIsCollapsed.get(),
				'cell saved with outputCollapsed metadata should open collapsed'
			).toBe(true);
		});

		it('clear output removes all outputs from the cell', () => {
			const notebook = createTestPositronNotebookInstance(
				[cellWithOutputs([textOutputItem('hello')], [pngOutputItem()])],
				ctx
			);
			const cell = firstCodeCell(notebook);
			expect(cell.outputs.get().length).toBe(2);

			notebook.clearCellOutput(cell);

			expect(cell.outputs.get().length).toBe(0);
		});

		it('context keys driving the action buttons track output state', () => {
			const notebook = createTestPositronNotebookInstance(
				[cellWithOutputs([textOutputItem('hello')])],
				ctx
			);
			const cell = firstCodeCell(notebook);

			// Attaching a container creates the cell's scoped context key
			// service and CellContextKeyManager, as the view layer does.
			cell.attachContainer(document.createElement('div'));
			const scoped = cell.scopedContextKeyService;
			expect(scoped).toBeDefined();

			// With outputs expanded: Collapse Output is eligible
			// (hasOutputs && !outputIsCollapsed per its menu when clause).
			expect(scoped?.getContextKeyValue(CellContextKeys.hasOutputs.key)).toBe(true);
			expect(scoped?.getContextKeyValue(CellContextKeys.outputIsCollapsed.key)).toBe(false);

			// Collapsed: Show Hidden Output (expand) becomes eligible
			// (hasOutputs && outputIsCollapsed).
			cell.collapseOutput();
			expect(scoped?.getContextKeyValue(CellContextKeys.outputIsCollapsed.key)).toBe(true);

			cell.expandOutput();
			expect(scoped?.getContextKeyValue(CellContextKeys.outputIsCollapsed.key)).toBe(false);

			// Cleared: no output-dependent action is eligible.
			notebook.clearCellOutput(cell);
			expect(scoped?.getContextKeyValue(CellContextKeys.hasOutputs.key)).toBe(false);
		});
	});
});
