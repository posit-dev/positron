/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import sinon from 'sinon';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../../../base/common/map.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ILanguageRuntimeMessageError, ILanguageRuntimeMetadata, LanguageRuntimeSessionMode, RuntimeExitReason, RuntimeOnlineState, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { TestLanguageRuntimeSession, waitForRuntimeState } from '../../../../services/runtimeSession/test/common/testLanguageRuntimeSession.js';
import { createTestLanguageRuntimeMetadata, startTestLanguageRuntimeSession } from '../../../../services/runtimeSession/test/common/testRuntimeSessionService.js';
import { PositronTestServiceAccessor, positronWorkbenchInstantiationService } from '../../../../test/browser/positronWorkbenchTestServices.js';
import { mock } from '../../../../test/common/workbenchTestServices.js';
import { NotebookTextModel } from '../../../notebook/common/model/notebookTextModel.js';
import { CellKind, CellUri, NotebookCellExecutionState } from '../../../notebook/common/notebookCommon.js';
import { CellExecutionUpdateType } from '../../../notebook/common/notebookExecutionService.js';
import { ICellExecuteUpdate, ICellExecutionComplete, INotebookCellExecution, INotebookExecutionStateService } from '../../../notebook/common/notebookExecutionStateService.js';
import { INotebookService } from '../../../notebook/common/notebookService.js';
import { createTestNotebookEditor, TestNotebookExecutionStateService } from '../../../notebook/test/browser/testNotebookEditor.js';
import { RuntimeNotebookKernel } from '../../browser/runtimeNotebookKernel.js';
import { ILanguageRuntimeCodeExecutedEvent } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { CodeAttributionSource } from '../../../../api/common/positron/extHostTypes.positron.js';

suite('Positron - RuntimeNotebookKernel', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let instantiationService: TestInstantiationService;
	let notebookExecutionStateService: TestNotebookExecutionStateService2;
	let runtimeSessionService: IRuntimeSessionService;
	let runtime: ILanguageRuntimeMetadata;
	let kernel: RuntimeNotebookKernel;
	let notebookDocument: NotebookTextModel;
	let rawCellIndex: number;
	let emptyCellIndex: number;

	setup(async () => {
		instantiationService = positronWorkbenchInstantiationService(disposables);
		const accessor = instantiationService.createInstance(PositronTestServiceAccessor);

		runtimeSessionService = accessor.runtimeSessionService;

		notebookExecutionStateService = new TestNotebookExecutionStateService2();
		instantiationService.stub(INotebookExecutionStateService, notebookExecutionStateService);

		// Create a test notebook document.
		notebookDocument = createTestNotebookEditor(
			instantiationService,
			disposables.add(new DisposableStore()),
			[
				['print(x)', 'python', CellKind.Code, [], {}],
				['print(y)', 'python', CellKind.Code, [], {}],
				['print(y)', 'raw', CellKind.Code, [], {}],
				['', 'python', CellKind.Code, [], {}],
			],
		).viewModel.notebookDocument;
		rawCellIndex = notebookDocument.cells.findIndex(cell => cell.language === 'raw');
		emptyCellIndex = notebookDocument.cells.findIndex(cell => cell.getValue() === '');

		// Stub a mocked notebook service that returns the test notebook document.
		instantiationService.stub(INotebookService, new class extends mock<INotebookService>() {
			override getNotebookTextModel(uri: URI): NotebookTextModel | undefined {
				return notebookDocument;
			}
		});

		// Create a test language runtime.
		runtime = createTestLanguageRuntimeMetadata(instantiationService, disposables);

		// Create the runtime notebook kernel.
		kernel = disposables.add(instantiationService.createInstance(RuntimeNotebookKernel, runtime));
	});

	/** Start a session for the test notebook and wait for it to be ready. */
	async function startSession() {
		const session = await startTestLanguageRuntimeSession(instantiationService, disposables, {
			runtime,
			notebookUri: notebookDocument.uri,
			sessionName: 'test',
			sessionMode: LanguageRuntimeSessionMode.Notebook,
			startReason: '',
		});
		await waitForRuntimeState(session, RuntimeState.Ready);
		return session;
	}

	/** Get a cell execution by cell index. */
	function getExecution(cellIndex: number) {
		const cell = notebookDocument.cells[cellIndex];
		assert.ok(cell);
		const execution = notebookExecutionStateService.executions.get(cell.uri);
		assert.ok(execution);
		return { cell, execution };
	}

	test('single cell executes successfully on status idle message', async () => {
		// Start a session.
		const session = await startSession();

		// On execute, reply with an idle state.
		disposables.add(session.onDidExecute(parent_id => session.receiveStateMessage({ parent_id, state: RuntimeOnlineState.Idle })));

		// Execute a cell.
		await kernel.executeNotebookCellsRequest(notebookDocument.uri, [0]);

		// Check that the execution was started and outputs were cleared.
		const { cell, execution } = getExecution(0);
		sinon.assert.calledOnceWithExactly(execution.update, [{
			editType: CellExecutionUpdateType.ExecutionState,
			runStartTime: sinon.match.number,
		}, {
			editType: CellExecutionUpdateType.Output,
			cellHandle: cell.handle,
			outputs: [],
		}]);

		// Check that the execution was completed.
		sinon.assert.calledOnceWithExactly(execution.complete, {
			runEndTime: sinon.match.number,
			lastRunSuccess: true,
		});

		// Check that the execution was started before it was completed.
		sinon.assert.callOrder(execution.update, execution.complete);
	});

	test('single cell emits execution events', async () => {
		// Start a session.
		const session = await startSession();

		// On execute, reply with an idle state.
		disposables.add(session.onDidExecute(parent_id => session.receiveStateMessage({ parent_id, state: RuntimeOnlineState.Idle })));

		// Establish the event handler.
		let event: ILanguageRuntimeCodeExecutedEvent | undefined = undefined;
		disposables.add(kernel.onDidExecuteCode(evt => {
			event = evt;
		}));

		// Execute a cell.
		await kernel.executeNotebookCellsRequest(notebookDocument.uri, [0]);

		// Verify the event.
		assert.ok(event !== undefined);
		const executed = event as ILanguageRuntimeCodeExecutedEvent;
		assert.strictEqual(executed.code, 'print(x)');
		assert.strictEqual(executed.languageId, 'python');
		assert.strictEqual(executed.attribution.source, CodeAttributionSource.Notebook);
	});


	test('single cell starts a new session if required', async () => {
		// When a session is started, setup its execute handler to reply with an idle state.
		disposables.add(runtimeSessionService.onWillStartSession(({ session }) => {
			assert.ok(session instanceof TestLanguageRuntimeSession);
			disposables.add(session);
			disposables.add(session.onDidExecute(parent_id => session.receiveStateMessage({ parent_id, state: RuntimeOnlineState.Idle })));
		}));

		// Execute a cell.
		await kernel.executeNotebookCellsRequest(notebookDocument.uri, [0]);

		// Check that the execution completed successfully.
		const execution = getExecution(0).execution;
		sinon.assert.calledOnceWithExactly(execution.complete, {
			runEndTime: sinon.match.number,
			lastRunSuccess: true,
		});
	});

	test('single cell executes unsuccessfully on error message', async () => {
		// Start a session.
		const session = await startSession();

		// On execute, reply with an error.
		const error = {
			name: 'TestError',
			message: 'An error occurred.',
			traceback: ['Error: An error occurred.', '    at <anonymous>:1:1'],
		} satisfies Partial<ILanguageRuntimeMessageError>;
		disposables.add(session.onDidExecute(parent_id => session.receiveErrorMessage({ ...error, parent_id })));

		// Execute a cell.
		await kernel.executeNotebookCellsRequest(notebookDocument.uri, [0]);

		// Check that the execution was completed with the error.
		const { cell, execution } = getExecution(0);
		sinon.assert.calledOnceWithExactly(execution.complete, {
			runEndTime: sinon.match.number,
			lastRunSuccess: false,
			error: {
				name: error.name,
				message: error.message,
				stack: error.traceback.join('\n'),
				uri: cell.uri,
				location: undefined,
			}
		});
	});

	test('raw cells are skipped', async () => {
		// Start a session.
		await startSession();

		// Execute the raw cell.
		await kernel.executeNotebookCellsRequest(notebookDocument.uri, [rawCellIndex]);

		// Check that the execution was not started or completed.
		const execution0 = getExecution(0).execution;
		sinon.assert.notCalled(execution0.update);
		sinon.assert.notCalled(execution0.complete);
	});

	test('empty cells are skipped', async () => {
		// Start a session.
		await startSession();

		// Execute the empty cell.
		await kernel.executeNotebookCellsRequest(notebookDocument.uri, [emptyCellIndex]);

		// Check that the execution was not started or completed.
		const execution0 = getExecution(0).execution;
		sinon.assert.notCalled(execution0.update);
		sinon.assert.notCalled(execution0.complete);
	});

	test('queued cells are not executed if a preceding cell errors', async () => {
		// Start a session.
		const session = await startSession();

		// On execute, reply with an error.
		disposables.add(session.onDidExecute(parent_id => session.receiveErrorMessage({ parent_id })));

		// Execute two cells.
		await kernel.executeNotebookCellsRequest(notebookDocument.uri, [0, 1]);

		// Check that the first execution completed with an error.
		const execution0 = getExecution(0).execution;
		const execution1 = getExecution(1).execution;
		sinon.assert.calledOnceWithExactly(execution0.complete, {
			runEndTime: sinon.match.number,
			lastRunSuccess: false,
			error: sinon.match.object,
		});

		// Check that the second execution never started or completed.
		sinon.assert.notCalled(execution1.update);
		sinon.assert.notCalled(execution1.complete);
	});

	test('queued cells execute in order (single execution)', async () => {
		// Start a session.
		const session = await startSession();

		// On execute, reply with an idle state.
		disposables.add(session.onDidExecute(parent_id => session.receiveStateMessage({ parent_id, state: RuntimeOnlineState.Idle })));

		// Execute two cells.
		await kernel.executeNotebookCellsRequest(notebookDocument.uri, [0, 1]);

		// Check that the second execution started before the first execution completed.
		const execution0 = getExecution(0).execution;
		const execution1 = getExecution(1).execution;
		sinon.assert.callOrder(execution0.update, execution0.complete, execution1.update, execution1.complete);
	});

	test('queued cells execute in order (multiple executions)', async () => {
		// Start a session.
		const session = await startSession();

		// On execute, reply with an idle state.
		disposables.add(session.onDidExecute(parent_id => session.receiveStateMessage({ parent_id, state: RuntimeOnlineState.Idle })));

		// Execute two cells concurrently.
		await Promise.all([
			kernel.executeNotebookCellsRequest(notebookDocument.uri, [0]),
			kernel.executeNotebookCellsRequest(notebookDocument.uri, [1]),
		]);

		// Check that the second execution started before the first execution completed.
		const execution0 = getExecution(0).execution;
		const execution1 = getExecution(1).execution;
		sinon.assert.callOrder(execution0.update, execution0.complete, execution1.update, execution1.complete);
	});

	test('internal state is reset after each execution', async () => {
		// Start a session.
		const session = await startSession();

		// On execute, reply with an idle state.
		disposables.add(session.onDidExecute(parent_id => session.receiveStateMessage({ parent_id, state: RuntimeOnlineState.Idle })));

		// Execute two cells successively.
		await kernel.executeNotebookCellsRequest(notebookDocument.uri, [0]);
		await kernel.executeNotebookCellsRequest(notebookDocument.uri, [1]);

		// Check that the second execution started before the first execution completed.
		const execution0 = getExecution(0).execution;
		const execution1 = getExecution(1).execution;
		sinon.assert.callOrder(execution0.update, execution0.complete, execution1.update, execution1.complete);
	});

	test('interrupt with running session and executing cell', async () => {
		// Start a session.
		const session = await startSession();


		// Create a promise that resolves when the execution starts.
		const executionStartedPromise = new Promise<void>(resolve => {
			// On execute, do nothing, to simulate a long-running execution.
			disposables.add(session.onDidExecute((_id) => {
				resolve();
			}));
		});

		// Create a promise that resolves when the execution ends.
		const executionEndedPromise = kernel.executeNotebookCellsRequest(notebookDocument.uri, [0]);

		// Wait for the execution to start.
		await executionStartedPromise;

		// Interrupt the execution.
		await kernel.cancelNotebookCellExecution(notebookDocument.uri, []);

		// Wait for the execution to end.
		await executionEndedPromise;

		// Check that the execution was completed with an error.
		const execution = getExecution(0).execution;
		sinon.assert.calledOnceWithExactly(execution.complete, {
			runEndTime: sinon.match.number,
			lastRunSuccess: false,
			error: sinon.match.object,
		});
	});

	test('interrupt with no executing cell', async () => {
		// Start a session.
		await startSession();

		// This should do nothing and not error.
		await kernel.cancelNotebookCellExecution(notebookDocument.uri, [0]);
	});

	test('interrupt with no running session', async () => {
		// Start a session.
		const session = await startSession();

		// Create a promise that resolves when the execution starts.
		const executionStartedPromise = new Promise<void>(resolve => {
			// On execute, do nothing, to simulate a long-running execution.
			disposables.add(session.onDidExecute((_id) => {
				resolve();
			}));
		});

		// Create a promise that resolves when the execution ends.
		const executionEndedPromise = kernel.executeNotebookCellsRequest(notebookDocument.uri, [0]);

		// Wait for the execution to start.
		await executionStartedPromise;

		// Spy on session.interrupt().
		const sessionInterruptSpy = sinon.spy(session, 'interrupt');

		// Exit the session after the execution started but before the interrupt.
		await session.shutdown(RuntimeExitReason.Shutdown);
		await waitForRuntimeState(session, RuntimeState.Exited);

		// Interrupt the execution.
		await kernel.cancelNotebookCellExecution(notebookDocument.uri, [0]);

		// Wait for the execution to end.
		await executionEndedPromise;

		// session.interrupt() should not be called.
		sinon.assert.notCalled(sessionInterruptSpy);

		// Even though the session was not interrupted, the execution should still end with an error.
		const execution = getExecution(0).execution;
		sinon.assert.calledOnceWithExactly(execution.complete, {
			runEndTime: sinon.match.number,
			lastRunSuccess: false,
			error: sinon.match.object,
		});
	});
});

/** A TestNotebookExecutionStateService that spies on cell executions. */
class TestNotebookExecutionStateService2 extends TestNotebookExecutionStateService {
	public readonly executions = new ResourceMap<sinon.SinonSpiedInstance<INotebookCellExecution>>();

	override getCellExecution(cellUri: URI): INotebookCellExecution | undefined {
		const parsedUri = CellUri.parse(cellUri);
		if (parsedUri === undefined) {
			throw new Error(`Invalid cell URI: ${cellUri.toString()}`);
		}
		const execution = new TestCellExecution(parsedUri.notebook, parsedUri.handle);
		const spy = sinon.spy(execution);
		this.executions.set(cellUri, spy);
		return execution;
	}
}

/** An INotebookCellExecution that does nothing. */
class TestCellExecution implements INotebookCellExecution {
	constructor(
		readonly notebook: URI,
		readonly cellHandle: number,
	) { }

	readonly state = NotebookCellExecutionState.Unconfirmed;

	readonly didPause: boolean = false;
	readonly isPaused: boolean = false;

	confirm(): void {
	}

	update(updates: ICellExecuteUpdate[]): void {
	}

	complete(complete: ICellExecutionComplete): void {
	}
}
