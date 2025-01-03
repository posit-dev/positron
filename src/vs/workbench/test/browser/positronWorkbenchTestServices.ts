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
import { IPositronVariablesService } from '../../services/positronVariables/common/interfaces/positronVariablesService.js';
import { PositronVariablesService } from '../../services/positronVariables/common/positronVariablesService.js';
import { IEditorService } from '../../services/editor/common/editorService.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { IRuntimeSessionService } from '../../services/runtimeSession/common/runtimeSessionService.js';
import { TestConfigurationService } from '../../../platform/configuration/test/common/testConfigurationService.js';
import { IPositronConsoleService } from '../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { PositronConsoleService } from '../../services/positronConsole/browser/positronConsoleService.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import { INotebookExecutionService } from '../../contrib/notebook/common/notebookExecutionService.js';
import { TestNotebookExecutionService } from '../common/positronWorkbenchTestServices.js';
import { IStatusbarService } from '../../services/statusbar/browser/statusbar.js';
import { StatusbarService } from '../../browser/parts/statusbar/statusbarPart.js';
import { INotebookService } from '../../contrib/notebook/common/notebookService.js';
import { INotebookKernelService } from '../../contrib/notebook/common/notebookKernelService.js';
import { INotebookExecutionStateService } from '../../contrib/notebook/common/notebookExecutionStateService.js';
import { TestNotebookExecutionStateService } from '../../contrib/notebook/test/browser/testNotebookEditor.js';
import { NotebookKernelService } from '../../contrib/notebook/browser/services/notebookKernelServiceImpl.js';
import { NotebookService } from '../../contrib/notebook/browser/services/notebookServiceImpl.js';
import { IRuntimeStartupService } from '../../services/runtimeStartup/common/runtimeStartupService.js';
import { RuntimeStartupService } from '../../services/runtimeStartup/common/runtimeStartup.js';
import { IPositronNewProjectService } from '../../services/positronNewProject/common/positronNewProject.js';
import { PositronNewProjectService } from '../../services/positronNewProject/common/positronNewProjectService.js';
import { IEphemeralStateService } from '../../../platform/ephemeralState/common/ephemeralState.js';
import { EphemeralStateService } from '../../../platform/ephemeralState/common/ephemeralStateService.js';
import { ILanguageService } from '../../../editor/common/languages/language.js';

export function positronWorkbenchInstantiationService(
	disposables: Pick<DisposableStore, 'add'> = new DisposableStore(),
	overrides?: {
		editorService?: (instantiationService: IInstantiationService) => IEditorService;
	},
): TestInstantiationService {
	const instantiationService = baseWorkbenchInstantiationService(overrides, disposables);

	createRuntimeServices(instantiationService, disposables);

	// Additional workbench services.
	instantiationService.stub(IStatusbarService, disposables.add(instantiationService.createInstance(StatusbarService)));
	instantiationService.stub(IWorkbenchThemeService, new TestThemeService() as any);
	instantiationService.stub(IWebviewService, disposables.add(new WebviewService(instantiationService)));
	instantiationService.stub(IViewsService, new TestViewsService());

	// Notebook services.
	instantiationService.stub(INotebookExecutionService, new TestNotebookExecutionService());
	instantiationService.stub(INotebookExecutionStateService, instantiationService.createInstance(TestNotebookExecutionStateService));
	instantiationService.stub(INotebookRendererMessagingService, disposables.add(instantiationService.createInstance(NotebookRendererMessagingService)));
	instantiationService.stub(INotebookEditorService, disposables.add(instantiationService.createInstance(NotebookEditorWidgetService)));
	instantiationService.stub(INotebookDocumentService, new NotebookDocumentWorkbenchService());
	instantiationService.stub(INotebookService, disposables.add(instantiationService.createInstance(NotebookService)));
	instantiationService.stub(INotebookKernelService, disposables.add(instantiationService.createInstance(NotebookKernelService)));

	// Positron services.
	instantiationService.stub(IEphemeralStateService, instantiationService.createInstance(EphemeralStateService));
	instantiationService.stub(IPositronNewProjectService, disposables.add(instantiationService.createInstance(PositronNewProjectService)));
	instantiationService.stub(IRuntimeStartupService, disposables.add(instantiationService.createInstance(RuntimeStartupService)));
	instantiationService.stub(IPositronNotebookOutputWebviewService, instantiationService.createInstance(PositronNotebookOutputWebviewService));
	instantiationService.stub(IPositronIPyWidgetsService, disposables.add(instantiationService.createInstance(PositronIPyWidgetsService)));
	instantiationService.stub(IPositronWebviewPreloadService, disposables.add(instantiationService.createInstance(PositronWebviewPreloadService)));
	instantiationService.stub(IPositronIPyWidgetsService, disposables.add(instantiationService.createInstance(PositronIPyWidgetsService)));
	instantiationService.stub(IPositronPlotsService, disposables.add(instantiationService.createInstance(PositronPlotsService)));
	instantiationService.stub(IPositronConsoleService, disposables.add(instantiationService.createInstance(PositronConsoleService)));
	instantiationService.stub(IPositronVariablesService, disposables.add(instantiationService.createInstance(PositronVariablesService)));

	return instantiationService;
}

export class PositronTestServiceAccessor {
	constructor(
		@IConfigurationService public configurationService: TestConfigurationService,
		@IEditorService public editorService: TestEditorService,
		@ILanguageService public languageService: ILanguageService,
		@ILogService public logService: ILogService,
		@INotebookEditorService public notebookEditorService: INotebookEditorService,
		@INotebookExecutionService public notebookExecutionService: TestNotebookExecutionService,
		@INotebookExecutionStateService public notebookExecutionStateService: TestNotebookExecutionStateService,
		@INotebookKernelService public notebookKernelService: NotebookKernelService,
		@INotebookService public notebookService: NotebookService,
		@IPositronIPyWidgetsService public positronIPyWidgetsService: PositronIPyWidgetsService,
		@IPositronPlotsService public positronPlotsService: IPositronPlotsService,
		@IPositronVariablesService public positronVariablesService: IPositronVariablesService,
		@IPositronWebviewPreloadService public positronWebviewPreloadService: PositronWebviewPreloadService,
		@IRuntimeSessionService public runtimeSessionService: IRuntimeSessionService,
		@IStatusbarService public statusbarService: IStatusbarService,
	) { }
}
