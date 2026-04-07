/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Event } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IWorkspaceTrustManagementService } from '../../../../../platform/workspace/common/workspaceTrust.js';
import sinon from 'sinon';
import { CellEditType, CellKind } from '../../../notebook/common/notebookCommon.js';
import { POSITRON_NOTEBOOK_OUTPUT_IMAGE_TARGETED } from '../../browser/ContextKeysManager.js';
import { TestWorkspaceTrustManagementService } from '../../../../test/common/workbenchTestServices.js';
import { IPositronWebviewPreloadService } from '../../../../services/positronWebviewPreloads/browser/positronWebviewPreloadService.js';
import { createTestPositronNotebookInstance, instantiateTestNotebookInstance, positronNotebookInstantiationService, TestCellInput } from './testPositronNotebookInstance.js';

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

function complexHtmlOutputItem() {
	return { mime: 'text/html', data: VSBuffer.fromString('<iframe src="https://example.com"></iframe>') };
}

function createDisplayPreloadResult(id: string) {
	return {
		preloadMessageType: 'display' as const,
		webview: Promise.resolve({
			id,
			sessionId: id,
			dispose: () => { },
			onDidRender: Event.None,
		}),
	};
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

		test('clearing outputs resets collapse state', () => {
			const notebook = createTestPositronNotebookInstance(
				[['print("hello")', 'python', CellKind.Code]],
				disposables
			);
			const cell = notebook.cells.get()[0];
			assert.ok(cell.isCodeCell());

			// Add output
			notebook.textModel!.applyEdits([{
				editType: CellEditType.Output,
				index: 0,
				outputs: [{ outputId: 'output-1', outputs: [textOutputItem('hello')] }],
				append: false,
			}], true, undefined, () => undefined, undefined, false);
			assert.strictEqual(cell.outputs.get().length, 1);

			// Collapse the output
			cell.collapseOutput();
			assert.strictEqual(cell.outputIsCollapsed.get(), true);

			// Clear outputs
			notebook.clearCellOutput(cell);

			assert.strictEqual(cell.outputs.get().length, 0);
			assert.strictEqual(cell.outputIsCollapsed.get(), false, 'collapse state should reset when outputs are cleared');
		});

		test('outputImageTargeted context key defaults to false and can be set', () => {
			const notebook = createTestPositronNotebookInstance(
				[['print("hello")', 'python', CellKind.Code]],
				disposables
			);

			const cellElement = document.createElement('div');
			const cellContextKeyService = notebook.scopedContextKeyService.createScoped(cellElement);
			disposables.add(cellContextKeyService);

			// Defaults to false
			assert.strictEqual(
				cellContextKeyService.getContextKeyValue(POSITRON_NOTEBOOK_OUTPUT_IMAGE_TARGETED.key),
				undefined,
				'outputImageTargeted should not be set by default'
			);

			// Can be bound and set to true (as the context menu handler does)
			const outputImageTargeted = POSITRON_NOTEBOOK_OUTPUT_IMAGE_TARGETED.bindTo(cellContextKeyService);
			outputImageTargeted.set(true);

			assert.strictEqual(
				cellContextKeyService.getContextKeyValue(POSITRON_NOTEBOOK_OUTPUT_IMAGE_TARGETED.key),
				true,
				'outputImageTargeted should be true after being set'
			);

			// Can be set back to false
			outputImageTargeted.set(false);
			assert.strictEqual(
				cellContextKeyService.getContextKeyValue(POSITRON_NOTEBOOK_OUTPUT_IMAGE_TARGETED.key),
				false,
				'outputImageTargeted should be false after being cleared'
			);
		});

		test('trusted complex HTML routes through the raw HTML webview path', () => {
			const addRawHtmlOutput = sinon.stub().returns(createDisplayPreloadResult('output-1'));
			const removeRawHtmlOutput = sinon.stub();
			const preloadService: IPositronWebviewPreloadService = {
				_serviceBrand: undefined,
				initialize: () => { },
				onDidCreatePlot: Event.None,
				sessionInfo: () => null,
				attachNotebookInstance: () => { },
				addNotebookOutput: () => undefined,
				addRawHtmlOutput,
				removeRawHtmlOutput,
			};

			const instantiationService = positronNotebookInstantiationService(disposables);
			instantiationService.stub(IPositronWebviewPreloadService, preloadService);

			const notebook = instantiateTestNotebookInstance([{
				source: 'map()',
				language: 'python',
				mime: undefined,
				cellKind: CellKind.Code,
				outputs: [{
					outputId: 'output-1',
					outputs: [complexHtmlOutputItem()],
				}],
			}], instantiationService, disposables);
			const cell = notebook.cells.get()[0];

			assert.ok(cell.isCodeCell());
			const outputs = cell.outputs.get();
			assert.strictEqual(outputs.length, 1);
			assert.strictEqual(outputs[0].parsed.type, 'html');
			assert.ok(outputs[0].preloadMessageResult);
			assert.strictEqual(addRawHtmlOutput.callCount, 1);
			assert.strictEqual(removeRawHtmlOutput.callCount, 0);
		});

		test('untrusted complex HTML is blocked instead of rendered inline', async () => {
			const addRawHtmlOutput = sinon.stub().returns(createDisplayPreloadResult('output-1'));
			const removeRawHtmlOutput = sinon.stub();
			const preloadService: IPositronWebviewPreloadService = {
				_serviceBrand: undefined,
				initialize: () => { },
				onDidCreatePlot: Event.None,
				sessionInfo: () => null,
				attachNotebookInstance: () => { },
				addNotebookOutput: () => undefined,
				addRawHtmlOutput,
				removeRawHtmlOutput,
			};

			const instantiationService = positronNotebookInstantiationService(disposables);
			instantiationService.stub(IPositronWebviewPreloadService, preloadService);

			const trustService = instantiationService.get(IWorkspaceTrustManagementService) as TestWorkspaceTrustManagementService;
			await trustService.setWorkspaceTrust(false);

			const notebook = instantiateTestNotebookInstance([{
				source: 'map()',
				language: 'python',
				mime: undefined,
				cellKind: CellKind.Code,
				outputs: [{
					outputId: 'output-1',
					outputs: [complexHtmlOutputItem()],
				}],
			}], instantiationService, disposables);
			const cell = notebook.cells.get()[0];

			assert.ok(cell.isCodeCell());
			const outputs = cell.outputs.get();
			assert.strictEqual(outputs.length, 1);
			assert.strictEqual(outputs[0].parsed.type, 'htmlBlocked');
			assert.strictEqual(outputs[0].preloadMessageResult, undefined);
			assert.strictEqual(addRawHtmlOutput.callCount, 0);
			assert.strictEqual(removeRawHtmlOutput.callCount, 1);
		});

		test('trust changes reroute persisted complex HTML outputs without rerunning the cell', async () => {
			const addRawHtmlOutput = sinon.stub().returns(createDisplayPreloadResult('output-1'));
			const removeRawHtmlOutput = sinon.stub();
			const preloadService: IPositronWebviewPreloadService = {
				_serviceBrand: undefined,
				initialize: () => { },
				onDidCreatePlot: Event.None,
				sessionInfo: () => null,
				attachNotebookInstance: () => { },
				addNotebookOutput: () => undefined,
				addRawHtmlOutput,
				removeRawHtmlOutput,
			};

			const instantiationService = positronNotebookInstantiationService(disposables);
			instantiationService.stub(IPositronWebviewPreloadService, preloadService);

			const trustService = instantiationService.get(IWorkspaceTrustManagementService) as TestWorkspaceTrustManagementService;
			await trustService.setWorkspaceTrust(false);

			const notebook = instantiateTestNotebookInstance([{
				source: 'map()',
				language: 'python',
				mime: undefined,
				cellKind: CellKind.Code,
				outputs: [{
					outputId: 'output-1',
					outputs: [complexHtmlOutputItem()],
				}],
			}], instantiationService, disposables);
			const cell = notebook.cells.get()[0];
			assert.ok(cell.isCodeCell());

			let outputs = cell.outputs.get();
			assert.strictEqual(outputs[0].parsed.type, 'htmlBlocked');

			await trustService.setWorkspaceTrust(true);

			outputs = cell.outputs.get();
			assert.strictEqual(outputs[0].parsed.type, 'html');
			assert.ok(outputs[0].preloadMessageResult);
			assert.strictEqual(addRawHtmlOutput.callCount, 1);
			assert.strictEqual(removeRawHtmlOutput.callCount, 1);

			await trustService.setWorkspaceTrust(false);

			outputs = cell.outputs.get();
			assert.strictEqual(outputs[0].parsed.type, 'htmlBlocked');
			assert.strictEqual(outputs[0].preloadMessageResult, undefined);
			assert.strictEqual(removeRawHtmlOutput.callCount, 2);
		});
	});
});
