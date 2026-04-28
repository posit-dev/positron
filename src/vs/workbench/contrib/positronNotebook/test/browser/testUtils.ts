/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { Event } from '../../../../../base/common/event.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { EditorResolverService } from '../../../../services/editor/browser/editorResolverService.js';
import { IEditorResolverService } from '../../../../services/editor/common/editorResolverService.js';
import { IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';
import { createEditorPart } from '../../../../test/browser/workbenchTestServices.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { EditorPart } from '../../../../browser/parts/editor/editorPart.js';
import { INotebookService } from '../../../notebook/common/notebookService.js';
import { INotebookEditorModelResolverService } from '../../../notebook/common/notebookEditorModelResolverService.js';
import { INotebookKernelService } from '../../../notebook/common/notebookKernelService.js';
import { INotebookExecutionService } from '../../../notebook/common/notebookExecutionService.js';
import { INotebookExecutionStateService } from '../../../notebook/common/notebookExecutionStateService.js';
import { IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronNotebookService } from '../../browser/positronNotebookService.js';
import { createTestContainer, PositronTestContainerBuilder } from '../../../../../test/vitest/positronTestContainer.js';

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
	onDidChangeExecution: Event.None,
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
};

// ---------------------------------------------------------------------------

/**
 * Returns a chained builder pre-loaded with the notebook editor services preset
 * and all file-scope service mocks. Use at describe scope -- call .build() after
 * adding any per-test stubs:
 *
 * ```ts
 * const ctx = notebookTestBuilder().build();
 * const ctx2 = notebookTestBuilder().stub(IConfigurationService, myService).build();
 * ```
 *
 * The preset already stubs IPositronWebviewPreloadService with a lightweight
 * display-type mock (see presets/notebookEditor.ts), so no override is needed.
 */
export function notebookTestBuilder(): PositronTestContainerBuilder {
	return createTestContainer()
		.withNotebookEditorServices()
		.stub(INotebookService, mockNotebookService)
		.stub(INotebookEditorModelResolverService, mockModelResolverService)
		.stub(INotebookKernelService, mockKernelService)
		.stub(INotebookExecutionService, mockExecutionService)
		.stub(INotebookExecutionStateService, mockExecutionStateService)
		.stub(ICommandService, mockCommandService)
		.stub(IRuntimeSessionService, mockRuntimeSessionService)
		.stub(IPositronNotebookService, mockPositronNotebookService);
}

export interface AttachedEditor {
	part: EditorPart;
	editorResolverService: EditorResolverService;
}

/**
 * Creates a real EditorPart and EditorResolverService and stubs them into the
 * provided instantiation service. Use inside beforeEach -- this is async work
 * that cannot live at describe scope.
 *
 * ```ts
 * beforeEach(async () => {
 *     ({ part, editorResolverService } = await attachEditorPart(
 *         ctx.instantiationService,
 *         ctx.disposables,
 *     ));
 * });
 * ```
 */
export async function attachEditorPart(
	instantiationService: TestInstantiationService,
	disposables: DisposableStore,
): Promise<AttachedEditor> {
	const part = await createEditorPart(instantiationService, disposables);
	instantiationService.stub(IEditorGroupsService, part);
	const editorResolverService = instantiationService.createInstance(EditorResolverService);
	instantiationService.stub(IEditorResolverService, editorResolverService);
	disposables.add(editorResolverService);
	return { part, editorResolverService };
}
