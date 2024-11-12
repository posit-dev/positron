/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from 'vs/base/common/lifecycle';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ILogService } from 'vs/platform/log/common/log';
import { TestThemeService } from 'vs/platform/theme/test/common/testThemeService';
import { INotebookEditorService } from 'vs/workbench/contrib/notebook/browser/services/notebookEditorService';
import { NotebookEditorWidgetService } from 'vs/workbench/contrib/notebook/browser/services/notebookEditorServiceImpl';
import { NotebookRendererMessagingService } from 'vs/workbench/contrib/notebook/browser/services/notebookRendererMessagingServiceImpl';
import { INotebookRendererMessagingService } from 'vs/workbench/contrib/notebook/common/notebookRendererMessagingService';
import { INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';
import { PositronIPyWidgetsService } from 'vs/workbench/contrib/positronIPyWidgets/browser/positronIPyWidgetsService';
import { IPositronNotebookOutputWebviewService } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewService';
import { PositronNotebookOutputWebviewService } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewServiceImpl';
import { PositronPlotsService } from 'vs/workbench/contrib/positronPlots/browser/positronPlotsService';
import { PositronWebviewPreloadService } from 'vs/workbench/contrib/positronWebviewPreloads/browser/positronWebviewPreloadsService';
import { IWebviewService } from 'vs/workbench/contrib/webview/browser/webview';
import { WebviewService } from 'vs/workbench/contrib/webview/browser/webviewService';
import { INotebookDocumentService, NotebookDocumentWorkbenchService } from 'vs/workbench/services/notebook/common/notebookDocumentService';
import { IPositronIPyWidgetsService } from 'vs/workbench/services/positronIPyWidgets/common/positronIPyWidgetsService';
import { IPositronPlotsService } from 'vs/workbench/services/positronPlots/common/positronPlots';
import { IPositronWebviewPreloadService } from 'vs/workbench/services/positronWebviewPreloads/common/positronWebviewPreloadService';
import { createRuntimeServices } from 'vs/workbench/services/runtimeSession/test/common/testRuntimeSessionService';
import { IWorkbenchThemeService } from 'vs/workbench/services/themes/common/workbenchThemeService';
import { IViewsService } from 'vs/workbench/services/views/common/viewsService';
import { workbenchInstantiationService as baseWorkbenchInstantiationService, TestViewsService } from 'vs/workbench/test/browser/workbenchTestServices';
import { TestNotebookService } from 'vs/workbench/test/common/positronWorkbenchTestServices';

export function positronWorkbenchInstantiationService(
	disposables: Pick<DisposableStore, 'add'> = new DisposableStore(),
): TestInstantiationService {
	const instantiationService = baseWorkbenchInstantiationService(undefined, disposables);

	createRuntimeServices(instantiationService, disposables);

	instantiationService.stub(INotebookRendererMessagingService, disposables.add(instantiationService.createInstance(NotebookRendererMessagingService)));
	instantiationService.stub(INotebookEditorService, disposables.add(instantiationService.createInstance(NotebookEditorWidgetService)));
	instantiationService.stub(IWorkbenchThemeService, new TestThemeService() as any);
	instantiationService.stub(INotebookDocumentService, new NotebookDocumentWorkbenchService());
	instantiationService.stub(INotebookService, new TestNotebookService());
	instantiationService.stub(IWebviewService, disposables.add(new WebviewService(instantiationService)));
	instantiationService.stub(IPositronNotebookOutputWebviewService, instantiationService.createInstance(PositronNotebookOutputWebviewService));
	instantiationService.stub(IPositronIPyWidgetsService, disposables.add(instantiationService.createInstance(PositronIPyWidgetsService)));
	instantiationService.stub(IPositronWebviewPreloadService, disposables.add(instantiationService.createInstance(PositronWebviewPreloadService)));
	instantiationService.stub(IPositronIPyWidgetsService, disposables.add(instantiationService.createInstance(PositronIPyWidgetsService)));
	instantiationService.stub(IViewsService, new TestViewsService());
	instantiationService.stub(IPositronPlotsService, disposables.add(instantiationService.createInstance(PositronPlotsService)));

	return instantiationService;
}

export class PositronTestServiceAccessor {
	constructor(
		@ILogService public logService: ILogService,
		@INotebookEditorService public notebookEditorService: INotebookEditorService,
		@IPositronIPyWidgetsService public positronIPyWidgetsService: PositronIPyWidgetsService,
		@IPositronPlotsService public positronPlotsService: IPositronPlotsService,
		@IPositronWebviewPreloadService public positronWebviewPreloadService: PositronWebviewPreloadService,
	) { }
}
