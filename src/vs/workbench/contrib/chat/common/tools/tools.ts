/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContribution } from '../../../../common/contributions.js';
import { ILanguageModelToolsService } from '../../common/languageModelToolsService.js';
import { EditTool, EditToolData } from './editFileTool.js';

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

		const editTool = instantiationService.createInstance(EditTool);
		this._register(toolsService.registerToolData(EditToolData));
		this._register(toolsService.registerToolImplementation(EditToolData.id, editTool));
	}
}

export interface IToolInputProcessor {
	processInput(input: any): any;
}

export const InternalFetchWebPageToolId = 'vscode_fetchWebPage_internal';
