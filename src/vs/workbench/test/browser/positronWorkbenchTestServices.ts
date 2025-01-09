/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from '../../../base/common/lifecycle.js';
import { TestInstantiationService } from '../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { TestThemeService } from '../../../platform/theme/test/common/testThemeService.js';
import { INotebookEditorService } from '../../contrib/notebook/browser/services/notebookEditorService.js';
import { NotebookEditorWidgetService } from '../../contrib/notebook/browser/services/notebookEditorServiceImpl.js';
import { NotebookRendererMessagingService } from '../../contrib/notebook/browser/services/notebookRendererMessagingServiceImpl.js';
import { INotebookRendererMessagingService } from '../../contrib/notebook/common/notebookRendererMessagingService.js';
import { INotebookService } from '../../contrib/notebook/common/notebookService.js';
import { PositronIPyWidgetsService } from '../../contrib/positronIPyWidgets/browser/positronIPyWidgetsService.js';
import { IPositronNotebookOutputWebviewService } from '../../contrib/positronOutputWebview/browser/notebookOutputWebviewService.js';
import { PositronNotebookOutputWebviewService } from '../../contrib/positronOutputWebview/browser/notebookOutputWebviewServiceImpl.js';
import { PositronPlotsService } from '../../contrib/positronPlots/browser/positronPlotsService.js';
import { PositronWebviewPreloadService } from '../../contrib/positronWebviewPreloads/browser/positronWebviewPreloadsService.js';
import { IWebviewService } from '../../contrib/webview/browser/webview.js';
import { WebviewService } from '../../contrib/webview/browser/webviewService.js';
import { INotebookDocumentService, NotebookDocumentWorkbenchService } from '../../services/notebook/common/notebookDocumentService.js';
import { IPositronIPyWidgetsService } from '../../services/positronIPyWidgets/common/positronIPyWidgetsService.js';
import { IPositronPlotsService } from '../../services/positronPlots/common/positronPlots.js';
import { IPositronWebviewPreloadService } from '../../services/positronWebviewPreloads/browser/positronWebviewPreloadService.js';
import { createRuntimeServices } from '../../services/runtimeSession/test/common/testRuntimeSessionService.js';
import { IWorkbenchThemeService } from '../../services/themes/common/workbenchThemeService.js';
import { IViewsService } from '../../services/views/common/viewsService.js';
import { workbenchInstantiationService as baseWorkbenchInstantiationService, TestEditorService, TestViewsService } from './workbenchTestServices.js';
import { TestNotebookService } from '../common/positronWorkbenchTestServices.js';
import { IPositronVariablesService } from '../../services/positronVariables/common/interfaces/positronVariablesService.js';
import { PositronVariablesService } from '../../services/positronVariables/common/positronVariablesService.js';
import { IEditorService } from '../../services/editor/common/editorService.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { IRuntimeSessionService } from '../../services/runtimeSession/common/runtimeSessionService.js';
import { TestConfigurationService } from '../../../platform/configuration/test/common/testConfigurationService.js';
import { IPositronConsoleService } from '../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { PositronConsoleService } from '../../services/positronConsole/browser/positronConsoleService.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';

export function positronWorkbenchInstantiationService(
	disposables: Pick<DisposableStore, 'add'> = new DisposableStore(),
	overrides?: {
		editorService?: (instantiationService: IInstantiationService) => IEditorService;
	},
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
	const editorService = overrides?.editorService ? overrides.editorService(instantiationService) : disposables.add(new TestEditorService());
	instantiationService.stub(IEditorService, editorService);
	instantiationService.stub(IConfigurationService, new TestConfigurationService());
	instantiationService.stub(IPositronConsoleService, disposables.add(instantiationService.createInstance(PositronConsoleService)));
	instantiationService.stub(IPositronVariablesService, disposables.add(instantiationService.createInstance(PositronVariablesService)));

	return instantiationService;
}

export class PositronTestServiceAccessor {
	constructor(
		@ILogService public logService: ILogService,
		@INotebookEditorService public notebookEditorService: INotebookEditorService,
		@IPositronIPyWidgetsService public positronIPyWidgetsService: PositronIPyWidgetsService,
		@IPositronPlotsService public positronPlotsService: IPositronPlotsService,
		@IPositronWebviewPreloadService public positronWebviewPreloadService: PositronWebviewPreloadService,
		@IPositronVariablesService public positronVariablesService: IPositronVariablesService,
		@IEditorService public editorService: TestEditorService,
		@IRuntimeSessionService public runtimeSessionService: IRuntimeSessionService,
	) { }
}
