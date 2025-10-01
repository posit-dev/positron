/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { EditorResolverService } from '../../../../services/editor/browser/editorResolverService.js';
import { IEditorResolverService } from '../../../../services/editor/common/editorResolverService.js';
import { IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';
import { createEditorPart, ITestInstantiationService, workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { EditorPart } from '../../../../browser/parts/editor/editorPart.js';
import { INotebookService } from '../../../notebook/common/notebookService.js';
import { INotebookEditorModelResolverService } from '../../../notebook/common/notebookEditorModelResolverService.js';
import { INotebookKernelService } from '../../../notebook/common/notebookKernelService.js';
import { INotebookExecutionService } from '../../../notebook/common/notebookExecutionService.js';
import { INotebookExecutionStateService } from '../../../notebook/common/notebookExecutionStateService.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronNotebookService } from '../../browser/positronNotebookService.js';
import { IPositronWebviewPreloadService } from '../../../../services/positronWebviewPreloads/browser/positronWebviewPreloadService.js';
import { Event } from '../../../../../base/common/event.js';

export interface TestServices {
	instantiationService: ITestInstantiationService;
	configurationService: TestConfigurationService;
	editorResolverService: EditorResolverService;
	part: EditorPart;
}

/**
 * Creates a complete set of test services for Positron Notebook testing.
 * This includes all necessary mocks and service stubs.
 */
export async function createPositronNotebookTestServices(disposables: DisposableStore): Promise<TestServices> {
	const instantiationService = workbenchInstantiationService(undefined, disposables);

	// Create configuration service with test defaults
	const configurationService = new TestConfigurationService();
	instantiationService.stub(IConfigurationService, configurationService);

	// Create editor part and resolver service
	const part = await createEditorPart(instantiationService, disposables);
	instantiationService.stub(IEditorGroupsService, part);

	const editorResolverService = instantiationService.createInstance(EditorResolverService);
	instantiationService.stub(IEditorResolverService, editorResolverService);
	disposables.add(editorResolverService);

	// Mock notebook service to support jupyter-notebook view type
	const mockNotebookService: Partial<INotebookService> = {
		canResolve: (viewType: string) => Promise.resolve(viewType === 'jupyter-notebook'),
		onWillAddNotebookDocument: Event.None,
		onDidAddNotebookDocument: Event.None,
		onWillRemoveNotebookDocument: Event.None,
		onDidRemoveNotebookDocument: Event.None,
		registerNotebookSerializer: () => ({ dispose: () => { } }),
		withNotebookDataProvider: () => Promise.resolve({} as any),
		getContributedNotebookTypes: () => [],
		getNotebookTextModel: () => undefined,
		listNotebookDocuments: () => [],
		getNotebookTextModels: () => []
	};
	instantiationService.stub(INotebookService, mockNotebookService);

	// Mock notebook model resolver service
	const mockModelResolverService: Partial<INotebookEditorModelResolverService> = {
		resolve: () => Promise.resolve({
			object: {
				notebook: {
					viewType: 'jupyter-notebook',
					uri: URI.file('/test/notebook.ipynb'),
					cells: [],
					onDidChangeContent: Event.None,
					onDidChangeNotebook: Event.None,
					getCells: () => [],
					length: 0
				} as any,
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
			} as any,
			dispose: () => { }
		})
	};
	instantiationService.stub(INotebookEditorModelResolverService, mockModelResolverService);

	// Mock Positron notebook service
	const mockPositronNotebookService = {
		registerInstance: () => { },
		unregisterInstance: () => { },
		getNotebookInstance: () => undefined
	};
	instantiationService.stub(IPositronNotebookService, mockPositronNotebookService);

	// Mock additional services required by PositronNotebookInstance
	const mockNotebookKernelService = {
		onDidChangeSelectedNotebooks: Event.None,
		getSelectedOrSuggestedKernel: () => undefined,
		selectKernelForNotebook: () => { }
	};
	instantiationService.stub(INotebookKernelService, mockNotebookKernelService);

	const mockNotebookExecutionService = {
		executeNotebookCells: () => Promise.resolve(),
		cancelNotebookCells: () => Promise.resolve()
	};
	instantiationService.stub(INotebookExecutionService, mockNotebookExecutionService);

	const mockNotebookExecutionStateService = {
		onDidChangeCellExecution: Event.None,
		getCellExecution: () => undefined
	};
	instantiationService.stub(INotebookExecutionStateService, mockNotebookExecutionStateService);

	const mockCommandService: Partial<ICommandService> = {
		onWillExecuteCommand: Event.None,
		onDidExecuteCommand: Event.None,
		executeCommand: <T = any>(_commandId: string, ..._args: any[]) => Promise.resolve(undefined as T | undefined)
	};
	instantiationService.stub(ICommandService, mockCommandService);

	const mockRuntimeSessionService: Partial<IRuntimeSessionService> = {
		onDidChangeRuntimeState: Event.None,
		onDidStartRuntime: Event.None,
		getSession: () => undefined
	};
	instantiationService.stub(IRuntimeSessionService, mockRuntimeSessionService);

	const mockWebviewPreloadService: Partial<IPositronWebviewPreloadService> = {
		initialize: () => { },
		attachNotebookInstance: () => { }
	};
	instantiationService.stub(IPositronWebviewPreloadService, mockWebviewPreloadService);

	return {
		instantiationService,
		configurationService,
		editorResolverService,
		part
	};
}
