/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from '../../../base/common/lifecycle.js';
import { TestInstantiationService } from '../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { createRuntimeServices } from '../../../workbench/services/runtimeSession/test/common/testRuntimeSessionService.js';
import { workbenchInstantiationService as baseWorkbenchInstantiationService } from '../../../workbench/test/browser/workbenchTestServices.js';
import { INotebookExecutionService } from '../../../workbench/contrib/notebook/common/notebookExecutionService.js';
import { INotebookExecutionStateService } from '../../../workbench/contrib/notebook/common/notebookExecutionStateService.js';
import { INotebookRendererMessagingService } from '../../../workbench/contrib/notebook/common/notebookRendererMessagingService.js';
import { NotebookRendererMessagingService } from '../../../workbench/contrib/notebook/browser/services/notebookRendererMessagingServiceImpl.js';
import { INotebookEditorService } from '../../../workbench/contrib/notebook/browser/services/notebookEditorService.js';
import { NotebookEditorWidgetService } from '../../../workbench/contrib/notebook/browser/services/notebookEditorServiceImpl.js';
import { INotebookDocumentService, NotebookDocumentWorkbenchService } from '../../../workbench/services/notebook/common/notebookDocumentService.js';
import { INotebookService } from '../../../workbench/contrib/notebook/common/notebookService.js';
import { NotebookService } from '../../../workbench/contrib/notebook/browser/services/notebookServiceImpl.js';
import { INotebookKernelService } from '../../../workbench/contrib/notebook/common/notebookKernelService.js';
import { NotebookKernelService } from '../../../workbench/contrib/notebook/browser/services/notebookKernelServiceImpl.js';
import { INotebookLoggingService } from '../../../workbench/contrib/notebook/common/notebookLoggingService.js';
import { NotebookLoggingService } from '../../../workbench/contrib/notebook/browser/services/notebookLoggingServiceImpl.js';
import { TestNotebookExecutionService } from '../../../workbench/test/common/positronWorkbenchTestServices.js';
import { TestNotebookExecutionStateService } from '../../../workbench/contrib/notebook/test/browser/testNotebookEditor.js';

/**
 * Notebook preset: base workbench (for editor/theme deps) + runtime services
 * + 8 notebook/kernel services (INotebookService, INotebookEditorService,
 * INotebookKernelService, etc.).
 *
 * Use for notebook-focused tests that don't need the full Positron workbench.
 */
export function createNotebookContainer(disposables: Pick<DisposableStore, 'add'>): TestInstantiationService {
	const svc = baseWorkbenchInstantiationService(undefined, disposables);
	createRuntimeServices(svc, disposables);
	svc.stub(INotebookExecutionService, new TestNotebookExecutionService());
	svc.stub(INotebookExecutionStateService, svc.createInstance(TestNotebookExecutionStateService));
	svc.stub(INotebookRendererMessagingService, disposables.add(svc.createInstance(NotebookRendererMessagingService)));
	svc.stub(INotebookEditorService, disposables.add(svc.createInstance(NotebookEditorWidgetService)));
	svc.stub(INotebookDocumentService, new NotebookDocumentWorkbenchService());
	svc.stub(INotebookService, disposables.add(svc.createInstance(NotebookService)));
	svc.stub(INotebookKernelService, disposables.add(svc.createInstance(NotebookKernelService)));
	svc.stub(INotebookLoggingService, disposables.add(svc.createInstance(NotebookLoggingService)));
	return svc;
}
