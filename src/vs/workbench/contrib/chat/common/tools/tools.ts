/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContribution } from '../../../../common/contributions.js';
import { ILanguageModelToolsService } from '../../common/languageModelToolsService.js';
// --- Start Positron ---
// Import is not used because the vscode_editFile_internal tool is not used in Positron.
/*
import { EditTool, EditToolData } from './editFileTool.js';
import { ManageTodoListTool, ManageTodoListToolData } from './manageTodoListTool.js';
*/
// --- End Positron ---

// --- Start Positron ---
/**
 * src/vs/workbench/contrib/chat/browser/tools/tools.ts is derived from this file.
 * Please keep the two files in sync with any core changes.
 */
// --- End Positron ---

export class BuiltinToolsContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'chat.builtinTools';

	constructor(
		@ILanguageModelToolsService toolsService: ILanguageModelToolsService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();

		// --- Start Positron ---
		// Don't register the vscode_editFile_internal in Positron, as it is not used: src/vs/workbench/contrib/chat/common/tools/editFileTool.ts
		// Instead, the positron_editFile_internal tool is used: src/vs/workbench/contrib/chat/browser/tools/editFileTool.ts
		/*
		const editTool = instantiationService.createInstance(EditTool);
		this._register(toolsService.registerToolData(EditToolData));
		this._register(toolsService.registerToolImplementation(EditToolData.id, editTool));

		const manageTodoListTool = instantiationService.createInstance(ManageTodoListTool);
		this._register(toolsService.registerToolData(ManageTodoListToolData));
		this._register(toolsService.registerToolImplementation(ManageTodoListToolData.id, manageTodoListTool));
		*/
		// --- End Positron ---
	}
}

export const InternalFetchWebPageToolId = 'vscode_fetchWebPage_internal';
