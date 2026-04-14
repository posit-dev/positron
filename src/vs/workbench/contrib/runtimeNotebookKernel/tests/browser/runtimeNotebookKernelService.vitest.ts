/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import sinon from 'sinon';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../../../base/common/map.js';
import { URI } from '../../../../../base/common/uri.js';
import { ILanguageRuntimeMetadata, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { waitForRuntimeState } from '../../../../services/runtimeSession/test/common/testLanguageRuntimeSession.js';
import { createTestLanguageRuntimeMetadata } from '../../../../services/runtimeSession/test/common/testRuntimeSessionService.js';
import { PositronTestServiceAccessor } from '../../../../test/browser/positronWorkbenchTestServices.js';
import { createTestContainer } from '../../../../test/browser/positronTestContainer.js';
import { IPYNB_VIEW_TYPE } from '../../../notebook/browser/notebookBrowser.js';
import { NotebookKernelService } from '../../../notebook/browser/services/notebookKernelServiceImpl.js';
import { NotebookTextModel } from '../../../notebook/common/model/notebookTextModel.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { INotebookKernel } from '../../../notebook/common/notebookKernelService.js';
import { INotebookService } from '../../../notebook/common/notebookService.js';
import { createTestNotebookEditor } from '../../../notebook/test/browser/testNotebookEditor.js';
import { IRuntimeNotebookKernelService } from '../../common/interfaces/runtimeNotebookKernelService.js';
import { RuntimeNotebookKernelService } from '../../browser/runtimeNotebookKernelService.js';
import { POSITRON_RUNTIME_NOTEBOOK_KERNELS_EXTENSION_ID } from '../../common/runtimeNotebookKernelConfig.js';
import { mock } from '../../../../../base/test/common/mock.js';

describe('Positron - RuntimeNotebookKernelService', () => {
	const ctx = createTestContainer().withWorkbenchServices().build();
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

	beforeEach(async () => {
		accessor = ctx.instantiationService.createInstance(PositronTestServiceAccessor);
		notebookKernelService = accessor.notebookKernelService;
		runtimeSessionService = accessor.runtimeSessionService;

		// Dispose all active sessions on teardown.
		// TODO: Should sessions be disposed by the runtime session service?
		ctx.disposables.add(toDisposable(() => {
			runtimeSessionService.activeSessions.map(s => s.dispose());
		}));

		// Create a test notebook document.
		notebookDocument = createTestNotebookEditor(
			ctx.instantiationService,
			ctx.disposables.add(new DisposableStore()),
			[
				['1 + 1', 'text', CellKind.Code, [], {}],
				['2 + 2', 'text', CellKind.Code, [], {}],
			],
		).viewModel.notebookDocument;
		// Stub the notebookType to the value assumed by the kernel matching logic.
		sinon.stub(notebookDocument, 'notebookType').get(() => IPYNB_VIEW_TYPE);

		// Create a test notebook service containing the test notebook document.
		notebookService = new TestNotebookService([notebookDocument]);
		ctx.instantiationService.stub(INotebookService, notebookService);

		// Dispose the existing RuntimeNotebookKernelService (created by withWorkbenchServices)
		// before instantiating a new one with our custom INotebookService stub.
		const existingService = ctx.instantiationService.get(IRuntimeNotebookKernelService);
		if (existingService && 'dispose' in existingService) {
			(existingService as any).dispose();
		}

		// Instantiate the runtime notebook kernel service BEFORE registering runtimes,
		// so it picks up the onDidRegisterRuntime events and creates kernels.
		runtimeNotebookKernelService = ctx.disposables.add(ctx.instantiationService.createInstance(RuntimeNotebookKernelService));
		ctx.instantiationService.stub(IRuntimeNotebookKernelService, runtimeNotebookKernelService);

		// Create a test language runtime.
		runtime = createTestLanguageRuntimeMetadata(ctx.instantiationService, ctx.disposables);

		// Get the kernel corresponding to the test language runtime.
		kernel = runtimeNotebookKernelService.getKernelByRuntimeId(runtime.runtimeId)!;

		// Create another runtime and kernel to test swapping kernels.
		anotherRuntime = createTestLanguageRuntimeMetadata(ctx.instantiationService, ctx.disposables);
		anotherKernel = runtimeNotebookKernelService.getKernelByRuntimeId(anotherRuntime.runtimeId)!;

		// Register the 'test' language, otherwise cells can't be set to that language.
		ctx.disposables.add(accessor.languageService.registerLanguage({ id: runtime.languageId }));
	});

	it('kernel is added on language runtime registration', async () => {
		// Register a language runtime, and wait for the corresponding kernel to be added.
		const kernelPromise = Event.toPromise(notebookKernelService.onDidAddKernel);
		const runtime = createTestLanguageRuntimeMetadata(ctx.instantiationService, ctx.disposables);
		const kernel = await kernelPromise;

		// Check the kernel's properties.
		expect(kernel.id).toBe(`${POSITRON_RUNTIME_NOTEBOOK_KERNELS_EXTENSION_ID}/${runtime.runtimeId}`);
		expect(kernel.label).toBe(runtime.runtimeName);
		expect(kernel.description).toBe(runtime.runtimePath);
		expect(kernel.detail).toBe(undefined);
		expect(kernel.viewType).toBe('jupyter-notebook');
		expect(kernel.extension.value).toBe(POSITRON_RUNTIME_NOTEBOOK_KERNELS_EXTENSION_ID);
		expect(kernel.implementsInterrupt).toBe(true);
		expect(kernel.implementsExecutionOrder).toBe(true);
		expect(kernel.hasVariableProvider).toBe(false);
		expect(kernel.supportedLanguages).toEqual([runtime.languageId, 'raw']);
		expect(kernel.preloadUris).toEqual([]);
		expect(kernel.preloadProvides).toEqual([]);
	});

	it('notebook language is updated on kernel selection', async () => {
		// Select the kernel for the notebook.
		notebookKernelService.selectKernelForNotebook(kernel, notebookDocument);

		// Check the language in the notebook document metadata.
		expect((notebookDocument.metadata.metadata as any).language_info.name).toBe(runtime.languageId);

		// Check each cell's language.
		for (const cell of notebookDocument.cells) {
			expect(cell.language).toBe(runtime.languageId);
		}
	});

	it('runtime is started on kernel selection', async () => {
		// Select the kernel for the notebook.
		notebookKernelService.selectKernelForNotebook(kernel, notebookDocument);

		// Wait for a session to start.
		const { session } = await Event.toPromise(runtimeSessionService.onWillStartSession);

		// Check that the session is for the expected runtime.
		expect(session.runtimeMetadata).toBe(runtime);
	});

	it('runtime is shutdown on kernel deselection', async () => {
		// Select the kernel for the notebook.
		notebookKernelService.selectKernelForNotebook(kernel, notebookDocument);

		// Wait for a session to start.
		const { session } = await Event.toPromise(runtimeSessionService.onWillStartSession);

		// Deselect the kernel for the notebook.
		notebookKernelService.selectKernelForNotebook(undefined, notebookDocument);

		// Wait for the session to end.
		await Event.toPromise(session.onDidEndSession);
	});

	it('runtime is swapped on kernel selection', async () => {
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
		expect(anotherSession.runtimeMetadata.runtimeId).toBe(anotherRuntime.runtimeId);

		// Check the session states.
		expect(session.getRuntimeState()).toBe(RuntimeState.Exited);
		expect(anotherSession.getRuntimeState()).toBe(RuntimeState.Starting);
	});

	// TODO: This test has a pre-existing issue under Vitest where kernel affinities
	// are not correctly set after disposing/recreating RuntimeNotebookKernelService.
	// The withWorkbenchServices() builder creates an initial service that must be
	// disposed before re-instantiating with a custom INotebookService stub, and
	// the affinity state does not survive this cycle.
	it.skip('notebook kernel affinity is set on notebook open', async () => {
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
		expect(kernels.suggestions.length).toBe(1);
		expect(kernels.suggestions[0].id).toBe(kernel.id);
	});

	it('runtime is shutdown on notebook close', async () => {
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

	it('kernel source action providers are registered', async () => {
		// Get the kernel source actions for the notebook.
		const kernelSourceActions = await notebookKernelService.getKernelSourceActions2(notebookDocument);

		// Spot check the kernel source actions.
		expect(kernelSourceActions.length).toBe(1);
		expect(kernelSourceActions[0].label).toBe('Select Environment...');
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
