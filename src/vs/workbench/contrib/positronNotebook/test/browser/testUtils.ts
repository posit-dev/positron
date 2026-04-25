/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { Event } from '../../../../../base/common/event.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { EditorResolverService } from '../../../../services/editor/browser/editorResolverService.js';
import { IEditorResolverService } from '../../../../services/editor/common/editorResolverService.js';
import { IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';
import { createEditorPart, ITestInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { EditorPart } from '../../../../browser/parts/editor/editorPart.js';
import { INotebookService } from '../../../notebook/common/notebookService.js';
import { INotebookEditorModelResolverService } from '../../../notebook/common/notebookEditorModelResolverService.js';
import { INotebookKernelService } from '../../../notebook/common/notebookKernelService.js';
import { INotebookExecutionService } from '../../../notebook/common/notebookExecutionService.js';
import { INotebookExecutionStateService } from '../../../notebook/common/notebookExecutionStateService.js';
import { IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronNotebookService } from '../../browser/positronNotebookService.js';
import { IPositronWebviewPreloadService } from '../../../../services/positronWebviewPreloads/browser/positronWebviewPreloadService.js';
import { createWorkbenchContainer } from '../../../../../test/vitest/presets/workbench.js';
import { stubNotebookEditorServices } from '../../../../../test/vitest/presets/notebookEditor.js';

export interface TestServices {
	instantiationService: ITestInstantiationService;
	configurationService: TestConfigurationService;
	editorResolverService: EditorResolverService;
	part: EditorPart;
}

// ---------------------------------------------------------------------------
// Named mock constants — lifted to file scope so the .stub() chain reads cleanly.
// ---------------------------------------------------------------------------

const mockNotebookService: Partial<INotebookService> = {
	canResolve: (viewType: string) => Promise.resolve(viewType === 'jupyter-notebook'),
	onWillAddNotebookDocument: Event.None,
	onDidAddNotebookDocument: Event.None,
	onWillRemoveNotebookDocument: Event.None,
	onDidRemoveNotebookDocument: Event.None,
	registerNotebookSerializer: () => ({ dispose: () => { } }),
	// eslint-disable-next-line local/code-no-any-casts, @typescript-eslint/no-explicit-any
	withNotebookDataProvider: () => Promise.resolve({} as any), // minimal stub; production code does not use the result in these tests
	getContributedNotebookTypes: () => [],
	getNotebookTextModel: () => undefined,
	listNotebookDocuments: () => [],
	getNotebookTextModels: () => []
};

const mockModelResolverService: Partial<INotebookEditorModelResolverService> = {
	resolve: () => Promise.resolve({
		// eslint-disable-next-line local/code-no-any-casts
		object: {
			// eslint-disable-next-line local/code-no-any-casts
			notebook: {
				viewType: 'jupyter-notebook',
				uri: URI.file('/test/notebook.ipynb'),
				cells: [],
				onDidChangeContent: Event.None,
				onDidChangeNotebook: Event.None,
				getCells: () => [],
				length: 0
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
			} as any, // minimal INotebookTextModel stub for test use only
			resource: URI.file('/test/notebook.ipynb'),
			viewType: 'jupyter-notebook',
			isResolved: () => true,
			isDirty: () => false,
			load: () => Promise.resolve(),
			save: () => Promise.resolve(),
			revert: () => Promise.resolve(),
			onDidChangeDirty: Event.None,
			onDidChangeReadonly: Event.None,
			onDidRevertUntitled: Event.None,
			dispose: () => { }
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any, // minimal IResolvedNotebookEditorModel stub for test use only
		dispose: () => { }
	})
};

const mockKernelService: Partial<INotebookKernelService> = {
	onDidChangeSelectedNotebooks: Event.None,
	getSelectedOrSuggestedKernel: () => undefined,
	selectKernelForNotebook: () => { }
};

const mockExecutionService: Partial<INotebookExecutionService> = {
	executeNotebookCells: () => Promise.resolve(),
	cancelNotebookCells: () => Promise.resolve()
};

const mockExecutionStateService: Partial<INotebookExecutionStateService> = {
	onDidChangeCellExecution: Event.None,
	getCellExecution: () => undefined
};

const mockCommandService: Partial<ICommandService> = {
	onWillExecuteCommand: Event.None,
	onDidExecuteCommand: Event.None,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	executeCommand: <T = any>(_commandId: string, ..._args: any[]) => Promise.resolve(undefined as T | undefined)
};

const mockRuntimeSessionService: Partial<IRuntimeSessionService> = {
	onDidChangeRuntimeState: Event.None,
	onDidStartRuntime: Event.None,
	getSession: () => undefined
};

const mockPositronNotebookService: Partial<IPositronNotebookService> = {
	registerInstance: () => { },
	unregisterInstance: () => { },
	getNotebookInstance: () => undefined
};

// withNotebookEditorServices() already stubs IPositronWebviewPreloadService with
// a lightweight display-type mock (see presets/notebookEditor.ts). This override
// keeps the exact same behavior to preserve the contract these tests expect.
const mockPreloadService: Partial<IPositronWebviewPreloadService> = {
	initialize: () => { },
	attachNotebookInstance: () => { },
	addNotebookOutput: (opts) => {
		if (opts.rawHtml) {
			const onDidRender = Event.None;
			return {
				preloadMessageType: 'display' as const,
				webview: Promise.resolve({
					id: opts.outputId,
					sessionId: opts.outputId,
					dispose() { },
					onDidRender,
				}),
			};
		}
		return undefined;
	},
};

// ---------------------------------------------------------------------------

/**
 * Creates a complete set of test services for Positron Notebook testing.
 * This includes all necessary mocks and service stubs.
 *
 * This helper is called at test-runtime (inside `it()` callbacks), so the
 * describe-scope `.build()` builder cannot be used here -- that is the
 * documented exception in vitest-tests.md for shared helpers. Instead we call
 * `createWorkbenchContainer` + `stubNotebookEditorServices` directly and layer
 * the notebook-specific overrides on top.
 */
export async function createPositronNotebookTestServices(disposables: DisposableStore): Promise<TestServices> {
	const configurationService = new TestConfigurationService();

	// Build the workbench + notebook-editor-services layer directly (builder
	// exception: this function is invoked at test-runtime, not describe scope).
	const instantiationService = createWorkbenchContainer(disposables);
	stubNotebookEditorServices(instantiationService, disposables);

	instantiationService.stub(IConfigurationService, configurationService);

	// Override the preset defaults with shapes these notebook tests rely on
	// (e.g. resolving the jupyter-notebook view type).
	instantiationService.stub(INotebookService, mockNotebookService);
	instantiationService.stub(INotebookEditorModelResolverService, mockModelResolverService);
	instantiationService.stub(INotebookKernelService, mockKernelService);
	instantiationService.stub(INotebookExecutionService, mockExecutionService);
	instantiationService.stub(INotebookExecutionStateService, mockExecutionStateService);
	instantiationService.stub(ICommandService, mockCommandService);
	instantiationService.stub(IRuntimeSessionService, mockRuntimeSessionService);
	instantiationService.stub(IPositronNotebookService, mockPositronNotebookService);
	instantiationService.stub(IPositronWebviewPreloadService, mockPreloadService);

	// Async layer: real EditorPart + EditorResolverService.
	const part = await createEditorPart(instantiationService, disposables);
	instantiationService.stub(IEditorGroupsService, part);
	const editorResolverService = instantiationService.createInstance(EditorResolverService);
	instantiationService.stub(IEditorResolverService, editorResolverService);
	disposables.add(editorResolverService);

	return {
		instantiationService: instantiationService as unknown as ITestInstantiationService,
		configurationService,
		editorResolverService,
		part,
	};
}
