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
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ILanguageRuntimeMetadata, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { waitForRuntimeState } from '../../../../services/runtimeSession/test/common/testLanguageRuntimeSession.js';
import { createTestLanguageRuntimeMetadata } from '../../../../services/runtimeSession/test/common/testRuntimeSessionService.js';
import { PositronTestServiceAccessor, positronWorkbenchInstantiationService } from '../../../../test/browser/positronWorkbenchTestServices.js';
import { IPYNB_VIEW_TYPE } from '../../../notebook/browser/notebookBrowser.js';
import { NotebookKernelService } from '../../../notebook/browser/services/notebookKernelServiceImpl.js';
import { NotebookTextModel } from '../../../notebook/common/model/notebookTextModel.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { INotebookKernel } from '../../../notebook/common/notebookKernelService.js';
import { INotebookService } from '../../../notebook/common/notebookService.js';
import { createTestNotebookEditor } from '../../../notebook/test/browser/testNotebookEditor.js';
import { IRuntimeNotebookKernelService } from '../../browser/interfaces/runtimeNotebookKernelService.js';
import { RuntimeNotebookKernelService } from '../../browser/runtimeNotebookKernelService.js';
import { POSITRON_RUNTIME_NOTEBOOK_KERNEL_ENABLED_KEY, POSITRON_RUNTIME_NOTEBOOK_KERNELS_EXTENSION_ID } from '../../common/runtimeNotebookKernelConfig.js';
import { mock } from '../../../../../base/test/common/mock.js';

suite('Positron - RuntimeNotebookKernelService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let instantiationService: TestInstantiationService;
	let accessor: PositronTestServiceAccessor;
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

		// Enable runtime notebook kernels.
		// NOTE: This must be done before creating the runtime notebook kernel service.
		accessor.configurationService.setUserConfiguration(POSITRON_RUNTIME_NOTEBOOK_KERNEL_ENABLED_KEY, true);

		notebookKernelService = accessor.notebookKernelService;
		runtimeSessionService = accessor.runtimeSessionService;

		// Dispose all active sessions on teardown.
		// TODO: Should sessions be disposed by the runtime session service?
		disposables.add(toDisposable(() => {
			runtimeSessionService.activeSessions.map(s => s.dispose());
		}));

		// Create a test language runtime.
		runtime = createTestLanguageRuntimeMetadata(instantiationService, disposables);

		// Create a test notebook document.
		notebookDocument = createTestNotebookEditor(
			instantiationService,
			disposables.add(new DisposableStore()),
			[
				['1 + 1', 'text', CellKind.Code, [], {}],
				['2 + 2', 'text', CellKind.Code, [], {}],
			],
		).viewModel.notebookDocument;
		// Stub the notebookType to the value assumed by the kernel matching logic.
		sinon.stub(notebookDocument, 'notebookType').get(() => IPYNB_VIEW_TYPE);

		// Create a test notebook service containing the test notebook document.
		notebookService = new TestNotebookService([notebookDocument]);
		instantiationService.stub(INotebookService, notebookService);

		// Instantiate the runtime notebook kernel service.
		runtimeNotebookKernelService = disposables.add(instantiationService.createInstance(RuntimeNotebookKernelService));
		instantiationService.stub(IRuntimeNotebookKernelService, runtimeNotebookKernelService);

		// Get the kernel corresponding to the test language runtime.
		kernel = runtimeNotebookKernelService.getKernelByRuntimeId(runtime.runtimeId)!;

		// Create another runtime and kernel to test swapping kernels.
		anotherRuntime = createTestLanguageRuntimeMetadata(instantiationService, disposables);
		anotherKernel = runtimeNotebookKernelService.getKernelByRuntimeId(anotherRuntime.runtimeId)!;

		// Register the 'test' language, otherwise cells can't be set to that language.
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
		// Select the kernel for the notebook.
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
		notebookKernelService.selectKernelForNotebook(kernel, notebookDocument);

		// Wait for a session to start.
		const { session } = await Event.toPromise(runtimeSessionService.onWillStartSession);

		// Check that the session is for the expected runtime.
		assert.strictEqual(session.runtimeMetadata, runtime);
	});

	test('runtime is shutdown on kernel deselection', async () => {
		// Select the kernel for the notebook.
		notebookKernelService.selectKernelForNotebook(kernel, notebookDocument);

		// Wait for a session to start.
		const { session } = await Event.toPromise(runtimeSessionService.onWillStartSession);

		// Deselect the kernel for the notebook.
		notebookKernelService.selectKernelForNotebook(undefined, notebookDocument);

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
		assert.strictEqual(anotherSession.runtimeMetadata.runtimeId, anotherRuntime.runtimeId);

		// Check the session states.
		assert.strictEqual(session.getRuntimeState(), RuntimeState.Exited);
		assert.strictEqual(anotherSession.getRuntimeState(), RuntimeState.Starting);
	});

	test('notebook kernel affinity is set on notebook open', async () => {
		// Set the notebook's language.
		notebookDocument.metadata = {
			metadata: {
				language_info: {
					name: runtime.languageId,
				},
			},
		};

		// Fire the event indicating that a notebook will open.
		notebookService.onWillAddNotebookDocumentEmitter.fire(notebookDocument);

		// Get the "matched" kernels for the notebook.
		const kernels = notebookKernelService.getMatchingKernel(notebookDocument);

		// Check that the expected kernel is the single suggestion i.e. that the kernel affinities
		// were correctly set for the notebook.
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
		// Get the kernel source actions for the notebook.
		const kernelSourceActions = await notebookKernelService.getKernelSourceActions2(notebookDocument);

		// Spot check the kernel source actions.
		assert.strictEqual(kernelSourceActions.length, 2);
		assert.strictEqual(kernelSourceActions[0].label, 'Python Environments...');
		assert.strictEqual(kernelSourceActions[1].label, 'R Environments...');
	});
});

/** INotebookService mock specifically for this test suite. */
class TestNotebookService extends mock<INotebookService>() {
	onWillAddNotebookDocumentEmitter = new Emitter<NotebookTextModel>();
	onWillRemoveNotebookDocumentEmitter = new Emitter<NotebookTextModel>();

	override onWillAddNotebookDocument = this.onWillAddNotebookDocumentEmitter.event;
	override onWillRemoveNotebookDocument = this.onWillRemoveNotebookDocumentEmitter.event;

	private _notebooks = new ResourceMap<NotebookTextModel>();

	constructor(notebooks: Iterable<NotebookTextModel>) {
		super();

		for (const notebook of notebooks) {
			this._notebooks.set(notebook.uri, notebook);
		}
	}

	override getNotebookTextModels(): Iterable<NotebookTextModel> {
		return this._notebooks.values();
	}

	override getNotebookTextModel(uri: URI): NotebookTextModel | undefined {
		return this._notebooks.get(uri);
	}
}
