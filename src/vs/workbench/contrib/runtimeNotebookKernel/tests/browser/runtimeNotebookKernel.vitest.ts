/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../../../base/common/map.js';
import { URI } from '../../../../../base/common/uri.js';
import { ILanguageRuntimeMessageError, ILanguageRuntimeMetadata, LanguageRuntimeSessionMode, RuntimeExitReason, RuntimeOnlineState, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { TestLanguageRuntimeSession, waitForRuntimeState } from '../../../../services/runtimeSession/test/common/testLanguageRuntimeSession.js';
import { createTestLanguageRuntimeMetadata, startTestLanguageRuntimeSession } from '../../../../services/runtimeSession/test/common/testRuntimeSessionService.js';
import { PositronTestServiceAccessor } from '../../../../test/browser/positronWorkbenchTestServices.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { mock } from '../../../../test/common/workbenchTestServices.js';
import { NotebookTextModel } from '../../../notebook/common/model/notebookTextModel.js';
import { CellKind, CellUri, NotebookCellExecutionState } from '../../../notebook/common/notebookCommon.js';
import { CellExecutionUpdateType } from '../../../notebook/common/notebookExecutionService.js';
import { ICellExecuteUpdate, ICellExecutionComplete, INotebookCellExecution, INotebookExecutionStateService } from '../../../notebook/common/notebookExecutionStateService.js';
import { INotebookService } from '../../../notebook/common/notebookService.js';
import { createTestNotebookEditor, TestNotebookExecutionStateService } from '../../../notebook/test/browser/testNotebookEditor.js';
import { RuntimeNotebookKernel } from '../../browser/runtimeNotebookKernel.js';
import { CodeAttributionSource } from '../../../../api/common/positron/extHostTypes.positron.js';
import { ILanguageRuntimeCodeExecutedEvent } from '../../../../services/positronConsole/common/positronConsoleCodeExecution.js';
import { INotebookEditorService } from '../../../notebook/browser/services/notebookEditorService.js';
import { NotebookEditorWidget } from '../../../notebook/browser/notebookEditorWidget.js';
import { NotebookOptions } from '../../../notebook/browser/notebookOptions.js';

describe('Positron - RuntimeNotebookKernel', () => {
	const ctx = createTestContainer().withWorkbenchServices().build();
	let notebookExecutionStateService: TestNotebookExecutionStateService2;
	let runtimeSessionService: IRuntimeSessionService;
	let runtime: ILanguageRuntimeMetadata;
	let kernel: RuntimeNotebookKernel;
	let notebookDocument: NotebookTextModel;
	let rawCellIndex: number;
	let emptyCellIndex: number;

	beforeEach(async () => {
		const accessor = ctx.instantiationService.createInstance(PositronTestServiceAccessor);

		runtimeSessionService = accessor.runtimeSessionService;

		notebookExecutionStateService = new TestNotebookExecutionStateService2();
		ctx.instantiationService.stub(INotebookExecutionStateService, notebookExecutionStateService);

		// Create a test notebook document.
		notebookDocument = createTestNotebookEditor(
			ctx.instantiationService,
			ctx.disposables.add(new DisposableStore()),
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
		ctx.instantiationService.stub(INotebookService, new class extends mock<INotebookService>() {
			override getNotebookTextModel(uri: URI): NotebookTextModel | undefined {
				return notebookDocument;
			}
		});

		// Stub a mocked notebook editor service that returns a widget with layout info.
		ctx.instantiationService.stub(INotebookEditorService, new class extends mock<INotebookEditorService>() {
			override retrieveExistingWidgetFromURI(_resource: URI) {
				const mockNotebookOptions = {
					getCellEditorContainerLeftMargin: () => 60,
					getLayoutConfiguration: () => ({ cellRightMargin: 16 }),
				} as unknown as NotebookOptions;

				const mockWidget = {
					getLayoutInfo: () => ({ width: 800 }),
					getDomNode: () => document.createElement('div'),
					notebookOptions: mockNotebookOptions,
				} as unknown as NotebookEditorWidget;

				return { value: mockWidget };
			}
		});

		// Clean up active sessions between tests to prevent leakage.
		ctx.disposables.add(toDisposable(() => {
			runtimeSessionService.activeSessions.forEach(s => s.dispose());
		}));

		// Create a test language runtime.
		runtime = createTestLanguageRuntimeMetadata(ctx.instantiationService, ctx.disposables);

		// Create the runtime notebook kernel.
		kernel = ctx.disposables.add(ctx.instantiationService.createInstance(RuntimeNotebookKernel, runtime));
	});

	/** Start a session for the test notebook and wait for it to be ready. */
	async function startSession() {
		const session = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables, {
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
		expect(cell).toBeDefined();
		const execution = notebookExecutionStateService.executions.get(cell.uri);
		expect(execution).toBeDefined();
		return { cell, execution: execution! };
	}

	it('single cell executes successfully on status idle message', async () => {
		// Start a session.
		const session = await startSession();

		// On execute, reply with an idle state.
		ctx.disposables.add(session.onDidExecute(parent_id => session.receiveStateMessage({ parent_id, state: RuntimeOnlineState.Idle })));

		// Execute a cell.
		await kernel.executeNotebookCellsRequest(notebookDocument.uri, [0]);

		// Check that the execution was started and outputs were cleared.
		const { cell, execution } = getExecution(0);
		expect(execution.update).toHaveBeenCalledOnce();
		expect(execution.update).toHaveBeenCalledWith([{
			editType: CellExecutionUpdateType.ExecutionState,
			runStartTime: expect.any(Number),
		}, {
			editType: CellExecutionUpdateType.Output,
			cellHandle: cell.handle,
			outputs: [],
		}]);

		// Check that the execution was completed.
		expect(execution.complete).toHaveBeenCalledOnce();
		expect(execution.complete).toHaveBeenCalledWith({
			runEndTime: expect.any(Number),
			lastRunSuccess: true,
		});

		// Check that the execution was started before it was completed.
		expect(execution.update.mock.invocationCallOrder[0])
			.toBeLessThan(execution.complete.mock.invocationCallOrder[0]);
	});

	it('single cell emits execution events', async () => {
		// Start a session.
		const session = await startSession();

		// On execute, reply with an idle state.
		ctx.disposables.add(session.onDidExecute(parent_id => session.receiveStateMessage({ parent_id, state: RuntimeOnlineState.Idle })));

		// Establish the event handler.
		let event: ILanguageRuntimeCodeExecutedEvent | undefined = undefined;
		ctx.disposables.add(kernel.onDidExecuteCode(evt => {
			event = evt;
		}));

		// Execute a cell.
		await kernel.executeNotebookCellsRequest(notebookDocument.uri, [0]);

		// Verify the event.
		expect(event).toBeDefined();
		const executed = event as unknown as ILanguageRuntimeCodeExecutedEvent;
		expect(executed.code).toBe('print(x)');
		expect(executed.languageId).toBe('python');
		expect(executed.attribution.source).toBe(CodeAttributionSource.Notebook);
	});


	it('single cell passes execution metadata with output_width_px and output_pixel_ratio', async () => {
		// Start a session.
		const session = await startSession();

		// Spy on session.execute to capture execution metadata.
		const executeSpy = vi.spyOn(session, 'execute');

		// On execute, reply with an idle state.
		ctx.disposables.add(session.onDidExecute(parent_id => session.receiveStateMessage({ parent_id, state: RuntimeOnlineState.Idle })));

		// Execute a cell.
		await kernel.executeNotebookCellsRequest(notebookDocument.uri, [0]);

		// Verify session.execute was called with executionMetadata.
		expect(executeSpy).toHaveBeenCalledOnce();
		const callArgs = executeSpy.mock.calls[0] as unknown as unknown[];
		const executionMetadata = callArgs[5] as Record<string, unknown>;
		expect(executionMetadata, 'executionMetadata should be provided').toBeDefined();
		expect(typeof executionMetadata.output_width_px).toBe('number');
		expect(typeof executionMetadata.output_pixel_ratio).toBe('number');
		// The mock widget has width 800, leftMargin 60, rightMargin 16,
		// so output_width_px should be 800 - 60 - 16 = 724.
		expect(executionMetadata.output_width_px).toBe(724);
		expect(executionMetadata.output_pixel_ratio as number, 'output_pixel_ratio should be a positive number').toBeGreaterThan(0);
	});

	it('single cell starts a new session if required', async () => {
		// When a session is started, setup its execute handler to reply with an idle state.
		ctx.disposables.add(runtimeSessionService.onWillStartSession(({ session }) => {
			expect(session).toBeInstanceOf(TestLanguageRuntimeSession);
			ctx.disposables.add(session);
			ctx.disposables.add((session as TestLanguageRuntimeSession).onDidExecute(parent_id => (session as TestLanguageRuntimeSession).receiveStateMessage({ parent_id, state: RuntimeOnlineState.Idle })));
		}));

		// Execute a cell.
		await kernel.executeNotebookCellsRequest(notebookDocument.uri, [0]);

		// Check that the execution completed successfully.
		const execution = getExecution(0).execution;
		expect(execution.complete).toHaveBeenCalledOnce();
		expect(execution.complete).toHaveBeenCalledWith({
			runEndTime: expect.any(Number),
			lastRunSuccess: true,
		});
	});

	it('single cell executes unsuccessfully on error message', async () => {
		// Start a session.
		const session = await startSession();

		// On execute, reply with an error.
		const error = {
			name: 'TestError',
			message: 'An error occurred.',
			traceback: ['Error: An error occurred.', '    at <anonymous>:1:1'],
		} satisfies Partial<ILanguageRuntimeMessageError>;
		ctx.disposables.add(session.onDidExecute(parent_id => session.receiveErrorMessage({ ...error, parent_id })));

		// Execute a cell.
		await kernel.executeNotebookCellsRequest(notebookDocument.uri, [0]);

		// Check that the execution was completed with the error.
		const { cell, execution } = getExecution(0);
		expect(execution.complete).toHaveBeenCalledOnce();
		expect(execution.complete).toHaveBeenCalledWith({
			runEndTime: expect.any(Number),
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

	it('raw cells are skipped', async () => {
		// Start a session.
		await startSession();

		// Execute the raw cell.
		await kernel.executeNotebookCellsRequest(notebookDocument.uri, [rawCellIndex]);

		// Check that the execution was not started or completed.
		const execution0 = getExecution(0).execution;
		expect(execution0.update).not.toHaveBeenCalled();
		expect(execution0.complete).not.toHaveBeenCalled();
	});

	it('empty cells are skipped', async () => {
		// Start a session.
		await startSession();

		// Execute the empty cell.
		await kernel.executeNotebookCellsRequest(notebookDocument.uri, [emptyCellIndex]);

		// Check that the execution was not started or completed.
		const execution0 = getExecution(0).execution;
		expect(execution0.update).not.toHaveBeenCalled();
		expect(execution0.complete).not.toHaveBeenCalled();
	});

	it('queued cells are not executed if a preceding cell errors', async () => {
		// Start a session.
		const session = await startSession();

		// On execute, reply with an error.
		ctx.disposables.add(session.onDidExecute(parent_id => session.receiveErrorMessage({ parent_id })));

		// Execute two cells.
		await kernel.executeNotebookCellsRequest(notebookDocument.uri, [0, 1]);

		// Check that the first execution completed with an error.
		const execution0 = getExecution(0).execution;
		const execution1 = getExecution(1).execution;
		expect(execution0.complete).toHaveBeenCalledOnce();
		expect(execution0.complete).toHaveBeenCalledWith({
			runEndTime: expect.any(Number),
			lastRunSuccess: false,
			error: expect.any(Object),
		});

		// Check that the second execution never started or completed.
		expect(execution1.update).not.toHaveBeenCalled();
		expect(execution1.complete).not.toHaveBeenCalled();
	});

	it('queued cells execute in order (single execution)', async () => {
		// Start a session.
		const session = await startSession();

		// On execute, reply with an idle state.
		ctx.disposables.add(session.onDidExecute(parent_id => session.receiveStateMessage({ parent_id, state: RuntimeOnlineState.Idle })));

		// Execute two cells.
		await kernel.executeNotebookCellsRequest(notebookDocument.uri, [0, 1]);

		// Check that cells executed in order: update0, complete0, update1, complete1.
		const execution0 = getExecution(0).execution;
		const execution1 = getExecution(1).execution;
		expect(execution0.update.mock.invocationCallOrder[0])
			.toBeLessThan(execution0.complete.mock.invocationCallOrder[0]);
		expect(execution0.complete.mock.invocationCallOrder[0])
			.toBeLessThan(execution1.update.mock.invocationCallOrder[0]);
		expect(execution1.update.mock.invocationCallOrder[0])
			.toBeLessThan(execution1.complete.mock.invocationCallOrder[0]);
	});

	it('queued cells execute in order (multiple executions)', async () => {
		// Start a session.
		const session = await startSession();

		// On execute, reply with an idle state.
		ctx.disposables.add(session.onDidExecute(parent_id => session.receiveStateMessage({ parent_id, state: RuntimeOnlineState.Idle })));

		// Execute two cells concurrently.
		await Promise.all([
			kernel.executeNotebookCellsRequest(notebookDocument.uri, [0]),
			kernel.executeNotebookCellsRequest(notebookDocument.uri, [1]),
		]);

		// Check that cells executed in order: update0, complete0, update1, complete1.
		const execution0 = getExecution(0).execution;
		const execution1 = getExecution(1).execution;
		expect(execution0.update.mock.invocationCallOrder[0])
			.toBeLessThan(execution0.complete.mock.invocationCallOrder[0]);
		expect(execution0.complete.mock.invocationCallOrder[0])
			.toBeLessThan(execution1.update.mock.invocationCallOrder[0]);
		expect(execution1.update.mock.invocationCallOrder[0])
			.toBeLessThan(execution1.complete.mock.invocationCallOrder[0]);
	});

	it('internal state is reset after each execution', async () => {
		// Start a session.
		const session = await startSession();

		// On execute, reply with an idle state.
		ctx.disposables.add(session.onDidExecute(parent_id => session.receiveStateMessage({ parent_id, state: RuntimeOnlineState.Idle })));

		// Execute two cells successively.
		await kernel.executeNotebookCellsRequest(notebookDocument.uri, [0]);
		await kernel.executeNotebookCellsRequest(notebookDocument.uri, [1]);

		// Check that cells executed in order: update0, complete0, update1, complete1.
		const execution0 = getExecution(0).execution;
		const execution1 = getExecution(1).execution;
		expect(execution0.update.mock.invocationCallOrder[0])
			.toBeLessThan(execution0.complete.mock.invocationCallOrder[0]);
		expect(execution0.complete.mock.invocationCallOrder[0])
			.toBeLessThan(execution1.update.mock.invocationCallOrder[0]);
		expect(execution1.update.mock.invocationCallOrder[0])
			.toBeLessThan(execution1.complete.mock.invocationCallOrder[0]);
	});

	it('interrupt with running session and executing cell', async () => {
		// Start a session.
		const session = await startSession();


		// Create a promise that resolves when the execution starts.
		const executionStartedPromise = new Promise<void>(resolve => {
			// On execute, do nothing, to simulate a long-running execution.
			ctx.disposables.add(session.onDidExecute((_id) => {
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
		expect(execution.complete).toHaveBeenCalledOnce();
		expect(execution.complete).toHaveBeenCalledWith({
			runEndTime: expect.any(Number),
			lastRunSuccess: false,
			error: expect.any(Object),
		});
	});

	it('interrupt with no executing cell', async () => {
		// Start a session.
		await startSession();

		// This should do nothing and not error.
		await kernel.cancelNotebookCellExecution(notebookDocument.uri, [0]);
	});

	it('interrupt with no running session', async () => {
		// Start a session.
		const session = await startSession();

		// Create a promise that resolves when the execution starts.
		const executionStartedPromise = new Promise<void>(resolve => {
			// On execute, do nothing, to simulate a long-running execution.
			ctx.disposables.add(session.onDidExecute((_id) => {
				resolve();
			}));
		});

		// Create a promise that resolves when the execution ends.
		const executionEndedPromise = kernel.executeNotebookCellsRequest(notebookDocument.uri, [0]);

		// Wait for the execution to start.
		await executionStartedPromise;

		// Spy on session.interrupt().
		const sessionInterruptSpy = vi.spyOn(session, 'interrupt');

		// Crash the session after the execution started but before the interrupt.
		await session.shutdown(RuntimeExitReason.Error);
		await waitForRuntimeState(session, RuntimeState.Exited);

		// Interrupt the execution.
		await kernel.cancelNotebookCellExecution(notebookDocument.uri, [0]);

		// Wait for the execution to end.
		await executionEndedPromise;

		// session.interrupt() should not be called.
		expect(sessionInterruptSpy).not.toHaveBeenCalled();

		// Even though the session was not interrupted, the execution should still end with an error.
		const execution = getExecution(0).execution;
		expect(execution.complete).toHaveBeenCalledOnce();
		expect(execution.complete).toHaveBeenCalledWith({
			runEndTime: expect.any(Number),
			lastRunSuccess: false,
			error: expect.any(Object),
		});
	});

	it('cell errors when the session exits unexpectedly mid-execution', async () => {
		// Start a session.
		const session = await startSession();

		// Start a long-running execution that never replies with an idle state.
		const executionStartedPromise = new Promise<void>(resolve => {
			ctx.disposables.add(session.onDidExecute(() => resolve()));
		});
		const executionEndedPromise = kernel.executeNotebookCellsRequest(notebookDocument.uri, [0]);
		await executionStartedPromise;

		// The runtime crashes mid-execution.
		await session.shutdown(RuntimeExitReason.Error);
		await waitForRuntimeState(session, RuntimeState.Exited);
		await executionEndedPromise;

		// The cell is marked as failed so the run button resets.
		const execution = getExecution(0).execution;
		expect(execution.complete).toHaveBeenCalledOnce();
		expect(execution.complete).toHaveBeenCalledWith({
			runEndTime: expect.any(Number),
			lastRunSuccess: false,
			error: expect.any(Object),
		});
	});

	it('cell ends without error when the session is restarted mid-execution', async () => {
		// Start a session.
		const session = await startSession();

		// Start a long-running execution that never replies with an idle state.
		const executionStartedPromise = new Promise<void>(resolve => {
			ctx.disposables.add(session.onDidExecute(() => resolve()));
		});
		const executionEndedPromise = kernel.executeNotebookCellsRequest(notebookDocument.uri, [0]);
		await executionStartedPromise;

		// The user restarts the runtime mid-execution.
		await session.shutdown(RuntimeExitReason.Restart);
		await waitForRuntimeState(session, RuntimeState.Exited);
		await executionEndedPromise;

		// The cell ends without a misleading error (and without a success result),
		// so the run button resets but the cell is shown as interrupted.
		const execution = getExecution(0).execution;
		expect(execution.complete).toHaveBeenCalledOnce();
		expect(execution.complete).toHaveBeenCalledWith({
			runEndTime: expect.any(Number),
		});
	});
});

/** A TestNotebookExecutionStateService that spies on cell executions. */
class TestNotebookExecutionStateService2 extends TestNotebookExecutionStateService {
	public readonly executions = new ResourceMap<TestCellExecution>();

	override getCellExecution(cellUri: URI): INotebookCellExecution | undefined {
		const parsedUri = CellUri.parse(cellUri);
		if (parsedUri === undefined) {
			throw new Error(`Invalid cell URI: ${cellUri.toString()}`);
		}
		const execution = new TestCellExecution(parsedUri.notebook, parsedUri.handle);
		this.executions.set(cellUri, execution);
		return execution;
	}
}

/** An INotebookCellExecution with vi.fn() methods for assertion. */
class TestCellExecution implements INotebookCellExecution {
	constructor(
		readonly notebook: URI,
		readonly cellHandle: number,
	) { }

	readonly state = NotebookCellExecutionState.Unconfirmed;

	readonly didPause: boolean = false;
	readonly isPaused: boolean = false;

	confirm = vi.fn();
	update = vi.fn<(updates: ICellExecuteUpdate[]) => void>();
	complete = vi.fn<(complete: ICellExecutionComplete) => void>();
}
