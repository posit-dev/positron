/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import sinon from 'sinon';
import { timeout } from '../../../../../base/common/async.js';
import { Event } from '../../../../../base/common/event.js';
import { DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../../../base/common/map.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ILanguageRuntimeMessageError, ILanguageRuntimeMetadata, LanguageRuntimeSessionMode, RuntimeExitReason, RuntimeOnlineState, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { TestLanguageRuntimeSession, waitForRuntimeState } from '../../../../services/runtimeSession/test/common/testLanguageRuntimeSession.js';
import { createTestLanguageRuntimeMetadata, startTestLanguageRuntimeSession } from '../../../../services/runtimeSession/test/common/testRuntimeSessionService.js';
import { PositronTestServiceAccessor, positronWorkbenchInstantiationService } from '../../../../test/browser/positronWorkbenchTestServices.js';
import { mock } from '../../../../test/common/workbenchTestServices.js';
import { NotebookKernelService } from '../../../notebook/browser/services/notebookKernelServiceImpl.js';
import { NotebookTextModel } from '../../../notebook/common/model/notebookTextModel.js';
import { CellKind, CellUri, NotebookCellExecutionState } from '../../../notebook/common/notebookCommon.js';
import { CellExecutionUpdateType } from '../../../notebook/common/notebookExecutionService.js';
import { ICellExecuteUpdate, ICellExecutionComplete, INotebookCellExecution, INotebookExecutionStateService } from '../../../notebook/common/notebookExecutionStateService.js';
import { INotebookService } from '../../../notebook/common/notebookService.js';
import { createTestNotebookEditor, MockNotebookCell, TestNotebookExecutionStateService } from '../../../notebook/test/browser/testNotebookEditor.js';
import { IRuntimeNotebookKernelService } from '../../browser/interfaces/runtimeNotebookKernelService.js';
import { RuntimeNotebookKernel } from '../../browser/runtimeNotebookKernel.js';
import { RuntimeNotebookKernelService } from '../../browser/runtimeNotebookKernelService.js';
import { POSITRON_RUNTIME_NOTEBOOK_KERNEL_ENABLED_KEY, POSITRON_RUNTIME_NOTEBOOK_KERNELS_EXTENSION_ID } from '../../common/runtimeNotebookKernelConfig.js';

suite('Positron - RuntimeNotebookKernelService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let instantiationService: TestInstantiationService;
	let accessor: PositronTestServiceAccessor;
	let configurationService: TestConfigurationService;
	let notebookKernelService: NotebookKernelService;
	let runtimeSessionService: IRuntimeSessionService;
	let notebookDocument: NotebookTextModel;

	setup(() => {
		instantiationService = positronWorkbenchInstantiationService(disposables);
		accessor = instantiationService.createInstance(PositronTestServiceAccessor);

		configurationService = accessor.configurationService;
		configurationService.setUserConfiguration(POSITRON_RUNTIME_NOTEBOOK_KERNEL_ENABLED_KEY, true);

		// TODO: This needs to be after we set the config key...
		instantiationService.stub(IRuntimeNotebookKernelService, disposables.add(instantiationService.createInstance(RuntimeNotebookKernelService)));

		notebookKernelService = accessor.notebookKernelService;

		// TODO
		runtimeSessionService = instantiationService.get(IRuntimeSessionService);
		disposables.add(toDisposable(() => {
			runtimeSessionService.activeSessions.map(s => s.dispose());
		}));

		const notebookEditorDisposables = disposables.add(new DisposableStore());
		const notebookEditor = createTestNotebookEditor(instantiationService, notebookEditorDisposables, []);
		notebookDocument = notebookEditor.viewModel.notebookDocument;
	});

	test('register a kernel on runtime register', async () => {
		const promise = Event.toPromise(notebookKernelService.onDidAddKernel);

		const runtime = createTestLanguageRuntimeMetadata(instantiationService, disposables);

		const kernel = await promise;

		assert.strictEqual(kernel.id, `${POSITRON_RUNTIME_NOTEBOOK_KERNELS_EXTENSION_ID}/${runtime.runtimeId}`);
		assert.strictEqual(kernel.label, runtime.runtimeName);
		assert.strictEqual(kernel.description, runtime.runtimePath);
		assert.strictEqual(kernel.detail, undefined);
		assert.strictEqual(kernel.viewType, 'jupyter-notebook');
		assert.strictEqual(kernel.extension.value, POSITRON_RUNTIME_NOTEBOOK_KERNELS_EXTENSION_ID);
		assert.strictEqual(kernel.implementsInterrupt, true);
		assert.strictEqual(kernel.implementsExecutionOrder, true);
		assert.strictEqual(kernel.hasVariableProvider, false);
		assert.deepStrictEqual(kernel.supportedLanguages, [runtime.languageId, 'raw']);
		assert.deepStrictEqual(kernel.preloadUris, []);
		assert.deepStrictEqual(kernel.preloadProvides, []);
	});

	test('select kernel starts a runtime', async () => {
		const promise = Event.toPromise(notebookKernelService.onDidAddKernel);
		const runtime = createTestLanguageRuntimeMetadata(instantiationService, disposables);
		const kernel = await promise;

		assert.strictEqual(runtimeSessionService.getNotebookSessionForNotebookUri(notebookDocument.uri), undefined);

		notebookKernelService.selectKernelForNotebook(kernel, notebookDocument);

		await timeout(0);

		// TODO: Check the started session's properties
		assert.strictEqual(runtimeSessionService.activeSessions.length, 1);
		assert.strictEqual(runtimeSessionService.getNotebookSessionForNotebookUri(notebookDocument.uri)?.runtimeMetadata, runtime);
	});

	test('select kernel updates the notebook language', async () => {
		const promise = Event.toPromise(notebookKernelService.onDidAddKernel);
		const runtime = createTestLanguageRuntimeMetadata(instantiationService, disposables);
		const kernel = await promise;

		assert.strictEqual(runtimeSessionService.getNotebookSessionForNotebookUri(notebookDocument.uri), undefined);

		// TODO: Why do we need to do this? Why isn't it handled by the test services?
		sinon.stub(accessor.notebookService, 'getNotebookTextModel').returns(notebookDocument);

		notebookKernelService.selectKernelForNotebook(kernel, notebookDocument);

		assert.strictEqual((notebookDocument.metadata.metadata as any).language_info.name, runtime.languageId);
		for (const cell of notebookDocument.cells) {
			assert.strictEqual(cell.language, runtime.languageId);
		}
	});

	// TODO
	test.skip('deselect kernel', async () => {
		const promise = Event.toPromise(notebookKernelService.onDidAddKernel);
		const runtime = createTestLanguageRuntimeMetadata(instantiationService, disposables);
		const kernel = await promise;

		assert.strictEqual(runtimeSessionService.getNotebookSessionForNotebookUri(notebookDocument.uri), undefined);

		notebookKernelService.selectKernelForNotebook(kernel, notebookDocument);

		await timeout(0);

		assert.strictEqual(runtimeSessionService.activeSessions.length, 1);
		assert.strictEqual(runtimeSessionService.getNotebookSessionForNotebookUri(notebookDocument.uri)?.runtimeMetadata, runtime);
	});

	test('swap kernel', async () => {
		const promise = Event.toPromise(notebookKernelService.onDidAddKernel);
		createTestLanguageRuntimeMetadata(instantiationService, disposables);
		const kernel = await promise;

		const anotherPromise = Event.toPromise(notebookKernelService.onDidAddKernel);
		const anotherRuntime = createTestLanguageRuntimeMetadata(instantiationService, disposables);
		const anotherKernel = await anotherPromise;

		assert.strictEqual(runtimeSessionService.getNotebookSessionForNotebookUri(notebookDocument.uri), undefined);

		notebookKernelService.selectKernelForNotebook(kernel, notebookDocument);

		const session = await Event.toPromise(runtimeSessionService.onDidStartRuntime);
		await waitForRuntimeState(session, RuntimeState.Ready);

		notebookKernelService.selectKernelForNotebook(anotherKernel, notebookDocument);

		await timeout(0);

		assert.strictEqual(runtimeSessionService.activeSessions.length, 2);
		assert.strictEqual(runtimeSessionService.getNotebookSessionForNotebookUri(notebookDocument.uri)?.runtimeMetadata, anotherRuntime);
	});

	// TODO: Kernel affinity.
	// TODO: Shutdown on notebook close.
	// TODO: Kernel source action providers?
});

suite('Positron - RuntimeNotebookKernel', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let instantiationService: TestInstantiationService;
	let notebookExecutionStateService: TestNotebookExecutionStateService2;
	let runtimeSessionService: IRuntimeSessionService;
	let runtime: ILanguageRuntimeMetadata;
	let kernel: RuntimeNotebookKernel;
	let notebookDocument: NotebookTextModel;

	setup(async () => {
		instantiationService = positronWorkbenchInstantiationService(disposables);
		const accessor = instantiationService.createInstance(PositronTestServiceAccessor);

		runtimeSessionService = accessor.runtimeSessionService;
		// notebookExecutionStateService = accessor.notebookExecutionStateService;

		// notebookExecutionStateService = new class extends TestNotebookExecutionStateService {
		// 	// override getCellExecution(_uri: URI): any {
		// 	// 	return undefined;
		// 	// }
		// 	// createCellExecution(notebook: URI, cellHandle: number): INotebookCellExecution {
		// 	// 	const onComplete = () => this._executions.delete(CellUri.generate(notebook, cellHandle));
		// 	// 	const exe = new TestCellExecution(notebook, cellHandle, onComplete);
		// 	// 	this._executions.set(CellUri.generate(notebook, cellHandle), exe);
		// 	// 	return exe;
		// 	// }
		// }();
		notebookExecutionStateService = new TestNotebookExecutionStateService2();
		instantiationService.stub(INotebookExecutionStateService, notebookExecutionStateService);

		const cells: MockNotebookCell[] = [
			['print(x)', 'python', CellKind.Code, [], {}],
			['print(y)', 'python', CellKind.Code, [], {}],
		];
		const notebookEditorDisposables = disposables.add(new DisposableStore());
		const notebookEditor = createTestNotebookEditor(instantiationService, notebookEditorDisposables, cells);
		notebookDocument = notebookEditor.viewModel.notebookDocument;

		instantiationService.stub(INotebookService, new class extends mock<INotebookService>() {
			override getNotebookTextModel(_uri: URI): NotebookTextModel | undefined {
				return notebookDocument;
			}
		});

		runtime = createTestLanguageRuntimeMetadata(instantiationService, disposables);
		kernel = disposables.add(instantiationService.createInstance(RuntimeNotebookKernel, runtime));
	});

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

	function getExecution(cellIndex: number) {
		const cell = notebookDocument.cells[cellIndex];
		assert.ok(cell);
		const execution = notebookExecutionStateService.executions.get(cell.uri);
		assert.ok(execution);
		return { cell, execution };
	}

	test('single cell executes successfully on status idle message', async () => {
		const session = await startSession();
		disposables.add(session.onDidExecute(parent_id => session.receiveStateMessage({ parent_id, state: RuntimeOnlineState.Idle })));

		await kernel.executeNotebookCellsRequest(notebookDocument.uri, [0]);

		// Check the execution.
		const { cell, execution } = getExecution(0);

		sinon.assert.calledOnceWithExactly(execution.update, [{
			editType: CellExecutionUpdateType.ExecutionState,
			runStartTime: sinon.match.number,
		}, {
			editType: CellExecutionUpdateType.Output,
			cellHandle: cell.handle,
			outputs: [],
		}]);

		sinon.assert.calledOnceWithExactly(execution.complete, {
			runEndTime: sinon.match.number,
			lastRunSuccess: true,
		});

		sinon.assert.callOrder(execution.update, execution.complete);
	});

	test('single cell starts a new session if required', async () => {
		disposables.add(runtimeSessionService.onWillStartSession(({ session }) => {
			assert.ok(session instanceof TestLanguageRuntimeSession);
			disposables.add(session);
			disposables.add(session.onDidExecute(parent_id => session.receiveStateMessage({ parent_id, state: RuntimeOnlineState.Idle })));
		}));

		// Execute a cell.
		await kernel.executeNotebookCellsRequest(notebookDocument.uri, [0]);

		// Check the execution.
		const execution = getExecution(0).execution;
		sinon.assert.calledOnceWithExactly(execution.complete, {
			runEndTime: sinon.match.number,
			lastRunSuccess: true,
		});
	});

	test('single cell executes unsuccessfully on error message', async () => {
		const session = await startSession();
		const error = {
			name: 'TestError',
			message: 'An error occurred.',
			traceback: ['Error: An error occurred.', '    at <anonymous>:1:1'],
		} satisfies Partial<ILanguageRuntimeMessageError>;

		disposables.add(session.onDidExecute(parent_id => session.receiveErrorMessage({ ...error, parent_id })));

		await kernel.executeNotebookCellsRequest(notebookDocument.uri, [0]);

		// Check the execution.
		const { cell, execution } = getExecution(0);
		sinon.assert.calledOnceWithExactly(execution.complete, {
			runEndTime: sinon.match.number,
			lastRunSuccess: false,
			error: {
				message: error.message,
				stack: error.traceback.join('\n'),
				uri: cell.uri,
				location: undefined,
			}
		});
	});

	test('queued cells are not executed if a preceding cell errors', async () => {
		const session = await startSession();
		disposables.add(session.onDidExecute(parent_id => session.receiveErrorMessage({ parent_id })));

		await kernel.executeNotebookCellsRequest(notebookDocument.uri, [0, 1]);

		// Check the execution.
		const execution0 = getExecution(0).execution;
		const execution1 = getExecution(1).execution;
		sinon.assert.calledOnceWithExactly(execution0.complete, {
			runEndTime: sinon.match.number,
			lastRunSuccess: false,
			error: sinon.match.object,
		});
		sinon.assert.notCalled(execution1.update);
		sinon.assert.notCalled(execution1.complete);
	});

	test('queued cells execute in order (single execution)', async () => {
		const session = await startSession();
		disposables.add(session.onDidExecute(parent_id => session.receiveStateMessage({ parent_id, state: RuntimeOnlineState.Idle })));

		await kernel.executeNotebookCellsRequest(notebookDocument.uri, [0, 1]);

		// Check the execution.
		const execution0 = getExecution(0).execution;
		const execution1 = getExecution(1).execution;

		sinon.assert.calledOnce(execution0.complete);
		sinon.assert.calledOnce(execution1.update);
		sinon.assert.callOrder(execution0.complete, execution1.update);
	});

	test('queued cells execute in order (multiple executions)', async () => {
		const session = await startSession();
		disposables.add(session.onDidExecute(parent_id => session.receiveStateMessage({ parent_id, state: RuntimeOnlineState.Idle })));

		await Promise.all([
			kernel.executeNotebookCellsRequest(notebookDocument.uri, [0]),
			kernel.executeNotebookCellsRequest(notebookDocument.uri, [1]),
		]);

		// Check the execution.
		const execution0 = getExecution(0).execution;
		const execution1 = getExecution(1).execution;

		sinon.assert.calledOnce(execution0.update);
		sinon.assert.calledOnce(execution0.complete);
		sinon.assert.calledOnce(execution1.update);
		sinon.assert.calledOnce(execution1.complete);
		sinon.assert.callOrder(execution0.update, execution0.complete, execution1.update, execution1.complete);
	});

	test('internal state is reset after each execution', async () => {
		const session = await startSession();
		disposables.add(session.onDidExecute(parent_id => session.receiveStateMessage({ parent_id, state: RuntimeOnlineState.Idle })));

		await kernel.executeNotebookCellsRequest(notebookDocument.uri, [0]);
		await kernel.executeNotebookCellsRequest(notebookDocument.uri, [1]);

		const execution0 = getExecution(0).execution;
		const execution1 = getExecution(1).execution;

		sinon.assert.calledOnce(execution0.update);
		sinon.assert.calledOnce(execution0.complete);
		sinon.assert.calledOnce(execution1.update);
		sinon.assert.calledOnce(execution1.complete);
		sinon.assert.callOrder(execution0.update, execution0.complete, execution1.update, execution1.complete);
	});

	test('interrupt with running session and executing cell', async () => {
		const session = await startSession();
		const executionStartedPromise = new Promise<void>(resolve => {
			disposables.add(session.onDidExecute((_id) => {
				// Don't fire an idle message since we're testing interrupt.
				resolve();
			}));
		});
		const executionEndedPromise = kernel.executeNotebookCellsRequest(notebookDocument.uri, [0]);
		await executionStartedPromise;

		// Interrupt and wait for the execution to end.
		await kernel.cancelNotebookCellExecution(notebookDocument.uri, [0]);
		await executionEndedPromise;

		const execution = getExecution(0).execution;
		sinon.assert.calledOnceWithExactly(execution.complete, {
			runEndTime: sinon.match.number,
			lastRunSuccess: false,
			error: sinon.match.object,
		});
	});

	test('interrupt with no executing cell', async () => {
		await startSession();

		// This should not error.
		await kernel.cancelNotebookCellExecution(notebookDocument.uri, [0]);
	});

	test('interrupt with no running session', async () => {
		const session = await startSession();
		const executionStartedPromise = new Promise<void>(resolve => {
			disposables.add(session.onDidExecute((_id) => {
				// Don't fire an idle message since we're testing interrupt.
				resolve();
			}));
		});
		const executionEndedPromise = kernel.executeNotebookCellsRequest(notebookDocument.uri, [0]);
		await executionStartedPromise;

		const sessionInterruptSpy = sinon.spy(session, 'interrupt');

		// Exit the session after the execution started but before the interrupt.
		await session.shutdown(RuntimeExitReason.Shutdown);

		// Interrupt and wait for the execution to end (it should actually end!).
		await kernel.cancelNotebookCellExecution(notebookDocument.uri, [0]);
		await executionEndedPromise;

		// session.interrupt() should not be called.
		sinon.assert.notCalled(sessionInterruptSpy);

		// The execution should still end unsuccessfully.
		const execution = getExecution(0).execution;
		sinon.assert.calledOnceWithExactly(execution.complete, {
			runEndTime: sinon.match.number,
			lastRunSuccess: false,
			error: sinon.match.object,
		});
	});
});

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
		// Do nothing.
	}
}
