/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { ICodeEditorService } from '../../../editor/browser/services/codeEditorService.js';
import { TestInstantiationService } from '../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { INotebookEditorService } from '../../../workbench/contrib/notebook/browser/services/notebookEditorService.js';
import { IPositronNotebookService } from '../../../workbench/contrib/positronNotebook/browser/positronNotebookService.js';
import { IQuartoKernelManager } from '../../../workbench/contrib/positronQuarto/browser/quartoKernelManager.js';

/**
 * Contribution services layer: Event.None stubs for services that workbench
 * contributions subscribe to in their constructors. Applied additively on top
 * of a workbench-level container — stackable with stubReactServices.
 *
 * Tests can override any of these with .stub() when they need to fire
 * specific events.
 */
export function stubContributionServices(svc: TestInstantiationService): void {
	svc.stub(INotebookEditorService, {
		onDidAddNotebookEditor: Event.None,
		onDidRemoveNotebookEditor: Event.None,
		listNotebookEditors: () => [],
	});
	svc.stub(ICodeEditorService, {
		onCodeEditorAdd: Event.None,
		onCodeEditorRemove: Event.None,
		listCodeEditors: () => [],
		getActiveCodeEditor: () => null,
	});
	svc.stub(IPositronNotebookService, {
		onDidAddNotebookInstance: Event.None,
		onDidRemoveNotebookInstance: Event.None,
		listInstances: () => [],
	});
	svc.stub(IQuartoKernelManager, {
		getSessionForDocument: () => undefined,
	});
}
