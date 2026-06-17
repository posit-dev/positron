/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter, Event } from '../../../../../base/common/event.js';
import { DisposableStore, IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../../../base/common/map.js';
import { URI } from '../../../../../base/common/uri.js';
import { timeout } from '../../../../../base/common/async.js';
import { ILanguageRuntimeMetadata, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { waitForRuntimeState } from '../../../../services/runtimeSession/test/common/testLanguageRuntimeSession.js';
import { createTestLanguageRuntimeMetadata } from '../../../../services/runtimeSession/test/common/testRuntimeSessionService.js';
import { PositronTestServiceAccessor } from '../../../../test/browser/positronWorkbenchTestServices.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { IPYNB_VIEW_TYPE } from '../../../notebook/browser/notebookBrowser.js';
import { NotebookKernelService } from '../../../notebook/browser/services/notebookKernelServiceImpl.js';
import { NotebookTextModel } from '../../../notebook/common/model/notebookTextModel.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { INotebookKernel } from '../../../notebook/common/notebookKernelService.js';
import { INotebookService } from '../../../notebook/common/notebookService.js';
import { createTestNotebookEditor } from '../../../notebook/test/browser/testNotebookEditor.js';
import { IRuntimeNotebookKernelService } from '../../common/interfaces/runtimeNotebookKernelService.js';
import { RuntimeNotebookKernel } from '../../browser/runtimeNotebookKernel.js';
import { RuntimeNotebookKernelService } from '../../browser/runtimeNotebookKernelService.js';
import { POSITRON_RUNTIME_NOTEBOOK_KERNELS_EXTENSION_ID } from '../../common/runtimeNotebookKernelConfig.js';
import { POSITRON_NOTEBOOK_EDITOR_INPUT_ID } from '../../../positronNotebook/common/positronNotebookCommon.js';
import { IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { GroupModelChangeKind, IEditorIdentifier } from '../../../../common/editor.js';
import { IGroupModelChangeEvent } from '../../../../common/editor/editorGroupModel.js';
import { TestEditorGroupView } from '../../../../test/browser/workbenchTestServices.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { mock } from '../../../../../base/test/common/mock.js';

/** Shape of Jupyter notebook metadata set by RuntimeNotebookKernelService when a kernel is selected. */
interface NotebookLanguageInfo {
	readonly language_info: { readonly name: string };
}

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
		vi.spyOn(notebookDocument, 'notebookType', 'get').mockReturnValue(IPYNB_VIEW_TYPE);

		// Create a test notebook service containing the test notebook document.
		notebookService = new TestNotebookService([notebookDocument]);
		ctx.instantiationService.stub(INotebookService, notebookService);

		// Dispose the existing RuntimeNotebookKernelService (created by withWorkbenchServices)
		// before instantiating a new one with our custom INotebookService stub.
		const existingService = ctx.instantiationService.get(IRuntimeNotebookKernelService);
		if (existingService && 'dispose' in existingService) {
			(existingService as IDisposable).dispose();
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
		expect((notebookDocument.metadata.metadata as NotebookLanguageInfo).language_info.name).toBe(runtime.languageId);

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
		expect(kernelSourceActions.length, `Unexpected kernel source actions: ${JSON.stringify(kernelSourceActions)}`).toBe(1);
		expect(kernelSourceActions[0].label).toBe('Select Environment...');
	});

	describe('Positron notebook editor active+pinned gate', () => {
		let positronInput: EditorInput;
		let decoyInput: EditorInput;
		let group: TestEditorGroupView;
		let modelChangeEmitter: Emitter<IGroupModelChangeEvent>;

		function makeStubEditorInput(typeId: string, uri: URI): EditorInput {
			return stubInterface<EditorInput>({
				typeId,
				resource: uri,
			});
		}

		function setActive(input: EditorInput): void {
			group.activeEditor = input;
		}

		function setPinned(input: EditorInput, pinned: boolean): void {
			vi.spyOn(group, 'isPinned').mockImplementation(editorOrIndex => editorOrIndex === input && pinned);
		}

		// Recreate the service after setting up the editor / group spies so
		// that listeners attach to our emitter and not the Event.None default.
		beforeEach(() => {
			positronInput = makeStubEditorInput(POSITRON_NOTEBOOK_EDITOR_INPUT_ID, notebookDocument.uri);
			decoyInput = makeStubEditorInput('workbench.input.text', URI.parse('file:///decoy.txt'));

			// Wire a real emitter onto the group so EDITOR_PIN events can be
			// fired in tests (the default test group's onDidModelChange is
			// Event.None).
			group = ctx.instantiationService.get(IEditorGroupsService).groups[0] as TestEditorGroupView;
			modelChangeEmitter = new Emitter<IGroupModelChangeEvent>();
			ctx.disposables.add(modelChangeEmitter);
			Object.defineProperty(group, 'onDidModelChange', { value: modelChangeEmitter.event, configurable: true });
			vi.spyOn(group, 'isPinned').mockReturnValue(false);

			// Make findEditors return the Positron notebook input for the test URI.
			vi.spyOn(accessor.editorService, 'findEditors').mockImplementation(((): readonly IEditorIdentifier[] => {
				return [{ groupId: group.id, editor: positronInput }];
			}) as typeof accessor.editorService.findEditors);

			// Recreate the service so its listeners pick up our emitter.
			runtimeNotebookKernelService.dispose();
			runtimeNotebookKernelService = ctx.disposables.add(
				ctx.instantiationService.createInstance(RuntimeNotebookKernelService));
			ctx.instantiationService.stub(IRuntimeNotebookKernelService, runtimeNotebookKernelService);
		});

		it('does NOT start a session when a Positron notebook editor input is in preview mode', async () => {
			setActive(positronInput);
			setPinned(positronInput, false);

			notebookKernelService.selectKernelForNotebook(kernel, notebookDocument);

			// Wait briefly to confirm no session starts.
			await timeout(50);
			expect(runtimeSessionService.activeSessions.length).toBe(0);
		});

		it('does NOT start a session for a Positron notebook editor that is not active in any group', async () => {
			setActive(decoyInput);
			setPinned(positronInput, true);

			notebookKernelService.selectKernelForNotebook(kernel, notebookDocument);

			await timeout(50);
			expect(runtimeSessionService.activeSessions.length).toBe(0);
		});

		it('starts the session immediately when a Positron notebook editor is active+pinned', async () => {
			setActive(positronInput);
			setPinned(positronInput, true);

			notebookKernelService.selectKernelForNotebook(kernel, notebookDocument);

			const { session } = await Event.toPromise(runtimeSessionService.onWillStartSession);
			expect(session.runtimeMetadata).toBe(runtime);
		});

		it('starts the deferred session when a preview tab is pinned', async () => {
			setActive(positronInput);
			setPinned(positronInput, false);

			// Selecting the kernel while preview should defer the start.
			notebookKernelService.selectKernelForNotebook(kernel, notebookDocument);
			await timeout(50);
			expect(runtimeSessionService.activeSessions.length).toBe(0);

			// Now simulate the user pinning the tab.
			setPinned(positronInput, true);
			modelChangeEmitter.fire({ kind: GroupModelChangeKind.EDITOR_PIN, editor: positronInput });

			const { session } = await Event.toPromise(runtimeSessionService.onWillStartSession);
			expect(session.runtimeMetadata).toBe(runtime);
		});

		it('does NOT start a deferred session if the kernel was deselected before the editor became active+pinned', async () => {
			setActive(positronInput);
			setPinned(positronInput, false);

			// Select the kernel while the editor is in preview; start is deferred.
			notebookKernelService.selectKernelForNotebook(kernel, notebookDocument);
			await timeout(50);
			expect(runtimeSessionService.activeSessions.length).toBe(0);

			// Deselect the kernel before the editor becomes active+pinned.
			notebookKernelService.selectKernelForNotebook(undefined, notebookDocument);

			// Now pin the tab. The previously-deferred kernel must NOT start.
			setPinned(positronInput, true);
			modelChangeEmitter.fire({ kind: GroupModelChangeKind.EDITOR_PIN, editor: positronInput });

			await timeout(50);
			expect(runtimeSessionService.activeSessions.length).toBe(0);
		});
	});

	describe('executeCodeInCell', () => {
		it('delegates to the selected kernel', async () => {
			// Select the kernel for the notebook.
			notebookKernelService.selectKernelForNotebook(kernel, notebookDocument);

			// Stub the kernel's executeCodeInCell to observe the delegation.
			const executeCodeInCellSpy = vi.spyOn(kernel as RuntimeNotebookKernel, 'executeCodeInCell')
				.mockResolvedValue(undefined);

			const cell = notebookDocument.cells[0];
			await runtimeNotebookKernelService.executeCodeInCell(notebookDocument.uri, cell.handle, '1 + 1');

			expect(executeCodeInCellSpy).toHaveBeenCalledOnce();
			expect(executeCodeInCellSpy).toHaveBeenCalledWith(notebookDocument.uri, cell.handle, '1 + 1');
		});

		it('throws when no kernel is selected for the notebook', async () => {
			await expect(
				runtimeNotebookKernelService.executeCodeInCell(notebookDocument.uri, notebookDocument.cells[0].handle, '1 + 1')
			).rejects.toThrow(/selected kernel/);
		});

		it('throws when the notebook has no text model', async () => {
			await expect(
				runtimeNotebookKernelService.executeCodeInCell(URI.parse('file:///unknown.ipynb'), 0, '1 + 1')
			).rejects.toThrow(/text model/);
		});
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
