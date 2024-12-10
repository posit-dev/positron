/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { strict as assert } from 'assert';
import * as path from 'path';
import * as positron from 'positron';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { JUPYTER_NOTEBOOK_TYPE } from '../constants';
import { DidEndExecutionEvent, DidStartExecutionEvent, NotebookController } from '../notebookController';
import { NotebookSessionService } from '../notebookSessionService';
import { log, onDidSetHasRunningNotebookSessionContext } from '../extension';
import { TestNotebookCellExecution } from './testNotebookCellExecution';
import { TestLanguageRuntimeSession } from './testLanguageRuntimeSession';
import { closeAllEditors, eventToPromise, openTestJupyterNotebookDocument } from './utils';

suite('NotebookController', () => {
	let runtime: positron.LanguageRuntimeMetadata;
	let disposables: vscode.Disposable[];
	let notebookSessionService: NotebookSessionService;
	let notebookController: NotebookController;
	let notebook: vscode.NotebookDocument;
	let session: TestLanguageRuntimeSession;
	let getNotebookSessionStub: sinon.SinonStub;
	let startLanguageRuntimeStub: sinon.SinonStub;
	let executions: TestNotebookCellExecution[];
	let onDidChangeSelectedNotebooks: vscode.EventEmitter<{
		readonly notebook: vscode.NotebookDocument;
		readonly selected: boolean;
	}>;
	let onDidCreateNotebookCellExecution: vscode.EventEmitter<TestNotebookCellExecution>;

	setup(async () => {
		disposables = [];

		// Reroute log messages to the console.
		for (const level of ['trace', 'debug', 'info', 'warn', 'error']) {
			sinon.stub(log, level as keyof typeof log).callsFake((...args) => {
				console.info('[Positron notebook controllers]', ...args);
			});
		}

		// Create a test session.
		session = new TestLanguageRuntimeSession();
		disposables.push(session);
		runtime = session.runtimeMetadata;

		// Open a test Jupyter notebook.
		notebook = await openTestJupyterNotebookDocument(runtime.languageId);

		// Stub vscode notebook controllers so that we can fire onDidChangeSelectedNotebooks manually.
		onDidChangeSelectedNotebooks = new vscode.EventEmitter();
		disposables.push(onDidChangeSelectedNotebooks);
		const createNotebookController = vscode.notebooks.createNotebookController;
		sinon.stub(vscode.notebooks, 'createNotebookController').callsFake((id, notebookType, label) => {
			const controller = createNotebookController(id, notebookType, label);
			sinon.stub(controller, 'onDidChangeSelectedNotebooks').value(onDidChangeSelectedNotebooks.event);
			return controller;
		});

		notebookSessionService = new NotebookSessionService();
		notebookController = new NotebookController(runtime, notebookSessionService);
		disposables.push(notebookController);

		// Stub the Positron API to return the test session.
		getNotebookSessionStub = sinon.stub(positron.runtime, 'getNotebookSession')
			.withArgs(notebook.uri).resolves(session as any);
		startLanguageRuntimeStub = sinon.stub(positron.runtime, 'startLanguageRuntime')
			.resolves(session as any);

		// Stub the vscode notebook controller to return a test cell execution.
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

	teardown(async () => {
		await closeAllEditors();
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
		const cellsToExecute = notebook.getCells().filter(cell => cellIndexes.includes(cell.index));
		return notebookController.controller.executeHandler(cellsToExecute, notebook, notebookController.controller);
	}

	function interruptNotebook() {
		return notebookController.controller.interruptHandler!(notebook);
	}

	test('select the controller for a notebook', async () => {
		// Simulate no session for the notebook.
		getNotebookSessionStub.withArgs(notebook.uri).resolves(undefined);

		// Stub the active notebook editor.
		sinon.stub(vscode.window, 'activeNotebookEditor').value({ notebook });

		// Capture the first two hasRunningNotebookSession context values.
		const promise = new Promise<boolean[]>(resolve => {
			const values: boolean[] = [];
			disposables.push(onDidSetHasRunningNotebookSessionContext(value => {
				values.push(value);
				if (values.length === 2) {
					resolve(values);
				}
			}));
		});

		// Select the controller for the notebook.
		onDidChangeSelectedNotebooks.fire({ notebook, selected: true });

		// Assert that the context is eventually set to false, then true.
		assert.deepStrictEqual(await promise, [false, true]);

		// Assert that startLanguageRuntime was called.
		sinon.assert.calledOnceWithExactly(
			startLanguageRuntimeStub,
			runtime.runtimeId,
			path.basename(notebook.uri.path),
			notebook.uri,
		);
	});

	test('deselect the controller for a notebook', async () => {
		// Stub the active notebook editor.
		sinon.stub(vscode.window, 'activeNotebookEditor').value({ notebook });

		// Create a promise that resolves when the hasRunningNotebookSession context is set.
		const promise = eventToPromise(onDidSetHasRunningNotebookSessionContext);

		// Deselect the controller for the notebook.
		onDidChangeSelectedNotebooks.fire({ notebook, selected: false });

		// Assert that the context is eventually set to false.
		assert.deepStrictEqual(await promise, false);
	});

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

		test('single cell starts a new session if required', async () => {
			// On execution, fire an idle message to complete the execution.
			disposables.push(session.onDidExecute((id) => session.fireIdleMessage(id)));

			// Simulate no session for the notebook.
			getNotebookSessionStub.withArgs(notebook.uri).resolves(undefined);

			// Stub the active notebook editor.
			sinon.stub(vscode.window, 'activeNotebookEditor').value({ notebook });

			// Create a promise that resolves when the hasRunningNotebookSession context is set.
			const promise = eventToPromise(onDidSetHasRunningNotebookSessionContext);

			// Execute a cell.
			await executeNotebook([0]);

			// Assert that the context is eventually set to true.
			assert.strictEqual(await promise, true);
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

			const sessionInterruptSpy = sinon.spy(session, 'interrupt');

			// Simulate the session exiting.
			getNotebookSessionStub.withArgs(notebook.uri).resolves(undefined);

			// Interrupt and wait for the execution to end (it should actually end!).
			await interruptNotebook();
			await executionEndedPromise;

			// session.interrupt() should not be called.
			sinon.assert.notCalled(sessionInterruptSpy);

			// The execution should still end unsuccessfully.
			assert.equal(executions.length, 1);
			executions[0].assertDidEndUnsuccessfully();
		});
	});
});
