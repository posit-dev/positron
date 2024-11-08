/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { strict as assert } from 'assert';
import * as positron from 'positron';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { JUPYTER_NOTEBOOK_TYPE } from '../constants';
import { NotebookController } from '../notebookController';
import { NotebookSessionService } from '../notebookSessionService';
import { log } from '../extension';
import { randomUUID } from 'crypto';
import { TestNotebookCellExecution } from './testNotebookCellExecution';

suite('NotebookController', () => {
	const runtime = {
		runtimeId: 'test-runtime-10349',
		runtimeName: 'Test Runtime',
		runtimePath: '/path/to/runtime',
		languageId: 'test-language',
	} as positron.LanguageRuntimeMetadata;

	let notebookSessionService: sinon.SinonStubbedInstance<NotebookSessionService>;
	let notebookController: NotebookController;
	let onDidReceiveRuntimeMessage: vscode.EventEmitter<positron.LanguageRuntimeMessage>;
	let notebook: vscode.NotebookDocument;
	let cells: vscode.NotebookCell[];
	let session: positron.LanguageRuntimeSession;
	let executions: TestNotebookCellExecution[];

	setup(async () => {
		// Reroute log messages to the console.
		for (const level of ['trace', 'debug', 'info', 'warn', 'error']) {
			sinon.stub(log, level as keyof typeof log).callsFake((...args) => {
				console.info('[Positron notebook controllers]', ...args);
			});
		}

		notebookSessionService = sinon.createStubInstance(NotebookSessionService);
		notebookController = new NotebookController(runtime, notebookSessionService as any);

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

		// Create a mock session.
		onDidReceiveRuntimeMessage = new vscode.EventEmitter();
		session = {
			metadata: {
				sessionId: 'test-session',
			},
			interrupt() { },
			onDidReceiveRuntimeMessage: onDidReceiveRuntimeMessage.event,
			execute(_code, _id, _mode, _errorBehavior) { }
		} as positron.LanguageRuntimeSession;
		notebookSessionService.getNotebookSession.withArgs(notebook.uri).returns(session);

		// Stub the notebook controller to return a test cell execution.
		executions = [];
		sinon.stub(notebookController.controller, 'createNotebookCellExecution')
			.callsFake((cell) => {
				const execution = new TestNotebookCellExecution(cell);
				executions.push(execution);
				return execution;
			});
	});

	teardown(() => {
		notebookController.dispose();
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

	function fireIdleMessage(parent_id: string) {
		onDidReceiveRuntimeMessage.fire({
			id: randomUUID(),
			type: positron.LanguageRuntimeMessageType.State,
			parent_id,
			when: new Date().toISOString(),
			state: positron.RuntimeOnlineState.Idle,
		} as positron.LanguageRuntimeState);
	}

	function fireErrorMessage(parent_id: string) {
		onDidReceiveRuntimeMessage.fire({
			id: randomUUID(),
			type: positron.LanguageRuntimeMessageType.Error,
			parent_id,
			when: new Date().toISOString(),
			message: 'An error occurred.',
			name: 'Error',
			traceback: ['Traceback line 1', 'Traceback line 2'],
		} as positron.LanguageRuntimeError);
	}

	suite('executeHandler', () => {
		test('single cell executes successfully on status idle message', async () => {
			// On execution, fire an idle message.
			sinon.stub(session, 'execute').callsFake((_code, id, _mode, _errorBehavior) => {
				fireIdleMessage(id);
			});

			await executeNotebook([0]);

			// Check the execution.
			assert.equal(executions.length, 1);
			executions[0].assertDidEndSuccessfully();
		});

		test('single cell executes unsuccessfully on error message', async () => {
			// On execution, fire an error message.
			sinon.stub(session, 'execute').callsFake((_code, id, _mode, _errorBehavior) => {
				fireErrorMessage(id);
			});

			await executeNotebook([0]);

			// Check the execution.
			assert.equal(executions.length, 1);
			executions[0].assertDidEndUnsuccessfully();
		});

		test('queued cells are not executed if a preceding cell errors', async () => {
			// On execution, fire an error message.
			sinon.stub(session, 'execute').callsFake((_code, id, _mode, _errorBehavior) => {
				fireErrorMessage(id);
			});

			await executeNotebook([0, 1]);

			// There should only be one execution.
			assert.equal(executions.length, 1);
			executions[0].assertDidEndUnsuccessfully();
		});

		test('queued cells execute in order', async () => {
			// On execution, fire an idle message for each cell in order.
			sinon.stub(session, 'execute').callsFake((_code, id, _mode, _errorBehavior) => {
				fireIdleMessage(id);
			});

			await executeNotebook([0, 1]);

			// Check the executions.
			assert.equal(executions.length, 2);
			assert.equal(executions[0].cell.index, 0);
			assert.equal(executions[1].cell.index, 1);
			executions[0].assertDidEndSuccessfully();
			executions[1].assertDidEndSuccessfully();
			executions[0].assertDidExecuteBefore(executions[1]);
		});
	});
});
