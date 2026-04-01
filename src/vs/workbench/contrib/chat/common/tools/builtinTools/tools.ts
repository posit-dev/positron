/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContribution } from '../../../../../common/contributions.js';
import { ILanguageModelToolsService } from '../languageModelToolsService.js';
import { ConfirmationTool, ConfirmationToolData } from './confirmationTool.js';
import { EditTool, EditToolData } from './editFileTool.js';
import { createManageTodoListToolData, ManageTodoListTool } from './manageTodoListTool.js';
import { RunSubagentTool } from './runSubagentTool.js';

// --- Start Positron ---
/**
 * src/vs/workbench/contrib/chat/browser/tools/tools.ts is derived from this file.
 * Please keep the two files in sync with any core changes and ensure that tools
 * do not conflict with each other.
 *
 * Note: There may be some overlap with tools and the ones registered here are
 * used by Copilot Chat.
 */
// --- End Positron ---

export class BuiltinToolsContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'chat.builtinTools';

	constructor(
		@ILanguageModelToolsService toolsService: ILanguageModelToolsService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();

		const editTool = instantiationService.createInstance(EditTool);
		this._register(toolsService.registerTool(EditToolData, editTool));

		const todoToolData = createManageTodoListToolData();
		const manageTodoListTool = this._register(instantiationService.createInstance(ManageTodoListTool));
		this._register(toolsService.registerTool(todoToolData, manageTodoListTool));

		// Register the confirmation tool
		const confirmationTool = instantiationService.createInstance(ConfirmationTool);
		this._register(toolsService.registerTool(ConfirmationToolData, confirmationTool));

		const runSubagentTool = this._register(instantiationService.createInstance(RunSubagentTool));

		let runSubagentRegistration: IDisposable | undefined;
		let toolSetRegistration: IDisposable | undefined;
		const registerRunSubagentTool = () => {
			runSubagentRegistration?.dispose();
			toolSetRegistration?.dispose();
			toolsService.flushToolUpdates();
			const runSubagentToolData = runSubagentTool.getToolData();
			runSubagentRegistration = toolsService.registerTool(runSubagentToolData, runSubagentTool);
			toolSetRegistration = toolsService.agentToolSet.addTool(runSubagentToolData);
		};
		registerRunSubagentTool();
		this._register(runSubagentTool.onDidUpdateToolData(registerRunSubagentTool));
		this._register({
			dispose: () => {
				runSubagentRegistration?.dispose();
				toolSetRegistration?.dispose();
			}
		});


	}
}

export const InternalFetchWebPageToolId = 'vscode_fetchWebPage_internal';
