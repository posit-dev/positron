/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import sinon from 'sinon';
import { Emitter, Event } from '../../../../../base/common/event.js';
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
import { INotebookKernel } from '../../../notebook/common/notebookKernelService.js';
import { IPYNB_VIEW_TYPE } from '../../../notebook/browser/notebookBrowser.js';

suite('Positron - RuntimeNotebookKernelService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let instantiationService: TestInstantiationService;
	let accessor: PositronTestServiceAccessor;
	let configurationService: TestConfigurationService;
	let notebookKernelService: NotebookKernelService;
	let runtimeSessionService: IRuntimeSessionService;
	let notebookDocument: NotebookTextModel;
	let runtime: ILanguageRuntimeMetadata;
	let kernel: INotebookKernel;
	let notebookService: TestNotebookService;
	let runtimeNotebookKernelService: RuntimeNotebookKernelService;
	let anotherRuntime: ILanguageRuntimeMetadata;
	let anotherKernel: INotebookKernel;

	setup(async () => {
		instantiationService = positronWorkbenchInstantiationService(disposables);
		accessor = instantiationService.createInstance(PositronTestServiceAccessor);

		configurationService = accessor.configurationService;
		configurationService.setUserConfiguration(POSITRON_RUNTIME_NOTEBOOK_KERNEL_ENABLED_KEY, true);

		notebookKernelService = accessor.notebookKernelService;

		// TODO
		runtimeSessionService = instantiationService.get(IRuntimeSessionService);
		disposables.add(toDisposable(() => {
			runtimeSessionService.activeSessions.map(s => s.dispose());
		}));

		runtime = createTestLanguageRuntimeMetadata(instantiationService, disposables);

		const notebookEditorDisposables = disposables.add(new DisposableStore());
		const cells: MockNotebookCell[] = [
			['1 + 1', 'text', CellKind.Code, [], {}],
			['2 + 2', 'text', CellKind.Code, [], {}],
		];
		const notebookEditor = createTestNotebookEditor(instantiationService, notebookEditorDisposables, cells);
		notebookDocument = notebookEditor.viewModel.notebookDocument;
		// TODO: This is needed by the kernel matching logic.
		sinon.stub(notebookDocument, 'notebookType').get(() => IPYNB_VIEW_TYPE);

		notebookService = new TestNotebookService([notebookDocument]);
		instantiationService.stub(INotebookService, notebookService);

		// TODO: This needs to be after we set the config key...
		runtimeNotebookKernelService = disposables.add(instantiationService.createInstance(RuntimeNotebookKernelService));
		instantiationService.stub(IRuntimeNotebookKernelService, runtimeNotebookKernelService);

		kernel = runtimeNotebookKernelService.getKernelByRuntimeId(runtime.runtimeId)!;

		anotherRuntime = createTestLanguageRuntimeMetadata(instantiationService, disposables);
		anotherKernel = runtimeNotebookKernelService.getKernelByRuntimeId(anotherRuntime.runtimeId)!;

		// Register the 'test' language.
		disposables.add(accessor.languageService.registerLanguage({ id: runtime.languageId }));
	});

	test('kernel is added on language runtime registration', async () => {
		// Register a language runtime, and wait for the corresponding kernel to be added.
		const kernelPromise = Event.toPromise(notebookKernelService.onDidAddKernel);
		const runtime = createTestLanguageRuntimeMetadata(instantiationService, disposables);
		const kernel = await kernelPromise;

		// Check the kernel's properties.
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

	test('notebook language is updated on kernel selection', async () => {
		notebookKernelService.selectKernelForNotebook(kernel, notebookDocument);

		// Check the language in the notebook document metadata.
		assert.strictEqual((notebookDocument.metadata.metadata as any).language_info.name, runtime.languageId);

		// Check each cell's language.
		for (const cell of notebookDocument.cells) {
			assert.strictEqual(cell.language, runtime.languageId);
		}
	});

	test('runtime is started on kernel selection', async () => {
		// Select the kernel for the notebook.
		accessor.notebookKernelService.selectKernelForNotebook(kernel, notebookDocument);

		// Wait for a session to start.
		const { session } = await Event.toPromise(runtimeSessionService.onWillStartSession);

		// Check that the session is for the expected runtime.
		assert.strictEqual(session.runtimeMetadata, runtime);
	});

	test('runtime is shutdown on kernel deselection', async () => {
		// Select the kernel for the notebook.
		accessor.notebookKernelService.selectKernelForNotebook(kernel, notebookDocument);

		// Wait for a session to start.
		const { session } = await Event.toPromise(runtimeSessionService.onWillStartSession);

		// Deselect the kernel for the notebook.
		accessor.notebookKernelService.selectKernelForNotebook(undefined, notebookDocument);

		// Wait for the session to end.
		await Event.toPromise(session.onDidEndSession);
	});

	test('runtime is swapped on kernel selection', async () => {
		// Select the kernel for the notebook.
		notebookKernelService.selectKernelForNotebook(kernel, notebookDocument);

		// Wait for a session to start and be ready for the expected runtime.
		const { session } = await Event.toPromise(runtimeSessionService.onWillStartSession);
		await waitForRuntimeState(session, RuntimeState.Ready);

		// Select another kernel for the notebook.
		notebookKernelService.selectKernelForNotebook(anotherKernel, notebookDocument);

		// Wait for the new session to start.
		const { session: anotherSession } = await Event.toPromise(runtimeSessionService.onWillStartSession);

		// Check that the new session is for the expected runtime.
		assert.strictEqual(anotherSession.runtimeMetadata, anotherRuntime);

		// Check the session states.
		assert.strictEqual(session.getRuntimeState(), RuntimeState.Exited);
		assert.strictEqual(anotherSession.getRuntimeState(), RuntimeState.Starting);
	});

	test('notebook kernel affinity is set on notebook open', async () => {
		// Stub the notebook to have the test runtime's language ID.
		sinon.stub(notebookDocument, 'metadata').get(() => ({
			metadata: {
				language_info: {
					name: runtime.languageId,
				},
			},
		}));

		// Fire the event indicating that a notebook will open.
		notebookService.onWillAddNotebookDocumentEmitter.fire(notebookDocument);

		// Get the "matched" kernels for the notebook.
		const kernels = notebookKernelService.getMatchingKernel(notebookDocument);

		// Check that the expected kernel is the single suggestion i.e. that the kernel affinities
		// were correctly set for the notebook.
		// A single suggested kernel is automatically selected by the notebook editor widget.
		assert.strictEqual(kernels.suggestions.length, 1);
		assert.strictEqual(kernels.suggestions[0].id, kernel.id);
	});

	test('runtime is shutdown on notebook close', async () => {
		// Select the kernel for the notebook.
		notebookKernelService.selectKernelForNotebook(kernel, notebookDocument);

		// Wait for a session to start and be ready for the expected runtime.
		const { session } = await Event.toPromise(runtimeSessionService.onWillStartSession);
		await waitForRuntimeState(session, RuntimeState.Ready);

		// Fire the event indicating that a notebook will close.
		notebookService.onWillRemoveNotebookDocumentEmitter.fire(notebookDocument);

		// Wait for the session to end.
		await Event.toPromise(session.onDidEndSession);
	});

	test('kernel source action providers are registered', async () => {
		const kernelSourceActions = await notebookKernelService.getKernelSourceActions2(notebookDocument);

		// Spot check the kernel source actions.
		assert.strictEqual(kernelSourceActions.length, 2);
		assert.strictEqual(kernelSourceActions[0].label, 'Python Environments...');
		assert.strictEqual(kernelSourceActions[1].label, 'R Environments...');
	});
});

suite('Positron - RuntimeNotebookKernel', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let instantiationService: TestInstantiationService;
	let accessor: PositronTestServiceAccessor;
	let notebookExecutionStateService: TestNotebookExecutionStateService2;
	let runtimeSessionService: IRuntimeSessionService;
	let runtime: ILanguageRuntimeMetadata;
	let kernel: RuntimeNotebookKernel;
	let notebookDocument: NotebookTextModel;

	setup(async () => {
		instantiationService = positronWorkbenchInstantiationService(disposables);
		accessor = instantiationService.createInstance(PositronTestServiceAccessor);

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
		await waitForRuntimeState(session, RuntimeState.Exited);

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

class TestNotebookService implements Partial<INotebookService> {
	onWillAddNotebookDocumentEmitter = new Emitter<NotebookTextModel>();
	onWillRemoveNotebookDocumentEmitter = new Emitter<NotebookTextModel>();

	onWillAddNotebookDocument = this.onWillAddNotebookDocumentEmitter.event;
	onWillRemoveNotebookDocument = this.onWillRemoveNotebookDocumentEmitter.event;

	private _notebooks = new ResourceMap<NotebookTextModel>();

	constructor(notebooks: Iterable<NotebookTextModel>) {
		for (const notebook of notebooks) {
			this._notebooks.set(notebook.uri, notebook);
		}
	}

	getNotebookTextModels(): Iterable<NotebookTextModel> {
		return this._notebooks.values();
	}

	getNotebookTextModel(uri: URI): NotebookTextModel | undefined {
		return this._notebooks.get(uri);
	}
}

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
