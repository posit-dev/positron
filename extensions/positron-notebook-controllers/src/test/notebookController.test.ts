/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { strict as assert } from 'assert';
import * as positron from 'positron';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { JUPYTER_NOTEBOOK_TYPE } from '../constants';
import { DidEndExecutionEvent, DidStartExecutionEvent, NotebookController } from '../notebookController';
import { NotebookSessionService } from '../notebookSessionService';
import { log } from '../extension';
import { TestNotebookCellExecution } from './testNotebookCellExecution';
import { TestLanguageRuntimeSession } from './testLanguageRuntimeSession';

suite('NotebookController', () => {
	const runtime = {
		runtimeId: 'test-runtime-10349',
		runtimeName: 'Test Runtime',
		runtimePath: '/path/to/runtime',
		languageId: 'test-language',
	} as positron.LanguageRuntimeMetadata;

	let disposables: vscode.Disposable[];
	let notebookSessionService: sinon.SinonStubbedInstance<NotebookSessionService>;
	let notebookController: NotebookController;
	let notebook: vscode.NotebookDocument;
	let cells: vscode.NotebookCell[];
	let session: TestLanguageRuntimeSession;
	let executions: TestNotebookCellExecution[];
	let onDidCreateNotebookCellExecution: vscode.EventEmitter<TestNotebookCellExecution>;

	setup(async () => {
		disposables = [];

		// Reroute log messages to the console.
		for (const level of ['trace', 'debug', 'info', 'warn', 'error']) {
			sinon.stub(log, level as keyof typeof log).callsFake((...args) => {
				console.info('[Positron notebook controllers]', ...args);
			});
		}

		notebookSessionService = sinon.createStubInstance(NotebookSessionService);
		notebookController = new NotebookController(runtime, notebookSessionService as any);
		disposables.push(notebookController);

		// Create a mock notebook.
		notebook = {
			metadata: {
				custom: {
					metadata: {
						language_info: {
							name: runtime.languageId,
						},
					},
				},
			},
			uri: vscode.Uri.parse('file:///path/to/notebook.ipynb'),
		} as Partial<vscode.NotebookDocument> as vscode.NotebookDocument;

		// Create mock cells.
		cells = [{
			index: 0,
			document: {
				getText: () => 'code',
				kind: vscode.NotebookCellKind.Code,
				languageId: runtime.languageId,
			} as Partial<vscode.TextDocument> as vscode.TextDocument,
			notebook,
		} as vscode.NotebookCell, {
			index: 1,
			document: {
				getText: () => 'more code',
				kind: vscode.NotebookCellKind.Code,
				languageId: runtime.languageId,
			} as Partial<vscode.TextDocument> as vscode.TextDocument,
			notebook,
		} as vscode.NotebookCell];

		// Create a test session.
		session = new TestLanguageRuntimeSession();
		disposables.push(session);
		notebookSessionService.getNotebookSession.withArgs(notebook.uri).returns(session as any);

		// Stub the notebook controller to return a test cell execution.
		executions = [];
		onDidCreateNotebookCellExecution = new vscode.EventEmitter();
		sinon.stub(notebookController.controller, 'createNotebookCellExecution')
			.callsFake((cell) => {
				const execution = new TestNotebookCellExecution(cell);
				executions.push(execution);
				onDidCreateNotebookCellExecution.fire(execution);
				return execution;
			});
	});

	teardown(() => {
		disposables.forEach(d => d.dispose());
		sinon.restore();
	});

	test('notebook controller properties', () => {
		assert.ok(notebookController);
		assert.equal(notebookController.label, runtime.runtimeName);

		const controller = notebookController.controller;
		assert.equal(controller.id, runtime.runtimeId);
		assert.equal(controller.notebookType, JUPYTER_NOTEBOOK_TYPE);
		assert.equal(controller.description, runtime.runtimePath);
		assert.equal(controller.supportsExecutionOrder, true);
		assert.deepEqual(controller.supportedLanguages, [runtime.languageId, 'raw']);
	});

	function executeNotebook(cellIndexes: number[]) {
		const cellsToExecute = cells.filter(cell => cellIndexes.includes(cell.index));
		return notebookController.controller.executeHandler(cellsToExecute, notebook, notebookController.controller);
	}

	function interruptNotebook() {
		return notebookController.controller.interruptHandler!(notebook);
	}

	suite('executeHandler', () => {
		test('single cell executes successfully on status idle message', async () => {
			disposables.push(session.onDidExecute((id) => session.fireIdleMessage(id)));

			await executeNotebook([0]);

			// Check the execution.
			assert.equal(executions.length, 1);
			executions[0].assertDidEndSuccessfully();
		});

		test('single cell fires start and end execution events', async () => {
			disposables.push(session.onDidExecute((id) => session.fireIdleMessage(id)));

			const startExecution = sinon.spy((_e: DidStartExecutionEvent) => { });
			disposables.push(notebookController.onDidStartExecution(startExecution));

			const endExecution = sinon.spy((_e: DidEndExecutionEvent) => { });
			disposables.push(notebookController.onDidEndExecution(endExecution));

			await executeNotebook([0]);

			const executedCells = [executions[0].cell];
			sinon.assert.calledOnceWithExactly(startExecution, { cells: executedCells });
			sinon.assert.calledOnceWithExactly(endExecution, sinon.match({ cells: executedCells, duration: sinon.match.number }));
			sinon.assert.callOrder(startExecution, endExecution);
		});

		test('single cell executes unsuccessfully on error message', async () => {
			disposables.push(session.onDidExecute((id) => session.fireErrorMessage(id)));

			await executeNotebook([0]);

			// Check the execution.
			assert.equal(executions.length, 1);
			executions[0].assertDidEndUnsuccessfully();
		});

		test('queued cells are not executed if a preceding cell errors', async () => {
			disposables.push(session.onDidExecute((id) => session.fireErrorMessage(id)));

			await executeNotebook([0, 1]);

			// There should only be one execution.
			assert.equal(executions.length, 1);
			executions[0].assertDidEndUnsuccessfully();
		});

		test('queued cells execute in order (single execution)', async () => {
			disposables.push(session.onDidExecute((id) => session.fireIdleMessage(id)));

			await executeNotebook([0, 1]);

			// Check the executions.
			assert.equal(executions.length, 2);
			assert.equal(executions[0].cell.index, 0);
			assert.equal(executions[1].cell.index, 1);
			executions[0].assertDidEndSuccessfully();
			executions[1].assertDidEndSuccessfully();
			executions[0].assertDidExecuteBefore(executions[1]);
		});

		test('queued cells execute in order (multiple executions)', async () => {
			disposables.push(session.onDidExecute((id) => session.fireIdleMessage(id)));

			await Promise.all([executeNotebook([0]), executeNotebook([1])]);

			// Check the executions.
			assert.equal(executions.length, 2);
			assert.equal(executions[0].cell.index, 0);
			assert.equal(executions[1].cell.index, 1);
			executions[0].assertDidEndSuccessfully();
			executions[1].assertDidEndSuccessfully();
			executions[0].assertDidExecuteBefore(executions[1]);
		});

		test('internal state is reset after each execution', async () => {
			disposables.push(session.onDidExecute((id) => session.fireIdleMessage(id)));

			await executeNotebook([0]);
			assert.equal(executions.length, 1);
			executions[0].assertDidEndSuccessfully();

			await executeNotebook([1]);
			assert.equal(executions.length, 2);
			executions[1].assertDidEndSuccessfully();
		});

		test('interrupt with running session and executing cell', async () => {
			const executionStartedPromise = new Promise<void>(resolve => {
				disposables.push(session.onDidExecute((_id) => {
					// Don't fire an idle message since we're testing interrupt.
					resolve();
				}));
			});
			const executionEndedPromise = executeNotebook([0]);
			await executionStartedPromise;

			// Interrupt and wait for the execution to end.
			await interruptNotebook();
			await executionEndedPromise;

			assert.equal(executions.length, 1);
			executions[0].assertDidEndUnsuccessfully();
		});

		test('interrupt with no executing cell', async () => {
			// This should not error.
			await interruptNotebook();

			assert.equal(executions.length, 0);
		});

		test('interrupt with no running session', async () => {
			const executionStartedPromise = new Promise<void>(resolve => {
				disposables.push(session.onDidExecute((_id) => {
					// Don't fire an idle message since we're testing interrupt.
					resolve();
				}));
			});
			const executionEndedPromise = executeNotebook([0]);
			await executionStartedPromise;

			// Simulate the session exiting.
			notebookSessionService.getNotebookSession.withArgs(notebook.uri).returns(undefined);

			// Interrupt and wait for the execution to end.
			await interruptNotebook();
			await executionEndedPromise;

			assert.equal(executions.length, 1);
			executions[0].assertDidEndUnsuccessfully();
		});
	});
});
