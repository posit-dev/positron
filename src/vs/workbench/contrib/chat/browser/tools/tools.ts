/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Based on src/vs/workbench/contrib/chat/common/tools/tools.ts.
 * This file is for Positron's builtin tools.
 * Positron's builtin tools may use services that cannot be used in the src/vs/workbench/contrib/chat/common
 * layer, so Positron has its own version of this file.
 */

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContribution } from '../../../../common/contributions.js';
import { ILanguageModelToolsService } from '../../common/languageModelToolsService.js';
import { TextSearchTool, TextSearchToolData } from './textSearchTool.js';
import { FileContentsTool, FileContentsToolData } from './fileContentsTool.js';
import { EditTool, EditToolData } from './editFileTool.js';

export class PositronBuiltinToolsContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'chat.positronBuiltinTools';

	constructor(
		@ILanguageModelToolsService _toolsService: ILanguageModelToolsService,
		@IInstantiationService _instantiationService: IInstantiationService,
	) {
		super();

		const toolDescriptors = [
			{ data: TextSearchToolData, ctor: TextSearchTool },
			{ data: FileContentsToolData, ctor: FileContentsTool },
			{ data: EditToolData, ctor: EditTool },
		];

		for (const { data, ctor } of toolDescriptors) {
			const tool = _instantiationService.createInstance(ctor);
			this._register(_toolsService.registerToolData(data));
			this._register(_toolsService.registerToolImplementation(data.id, tool));
		}
	}
}
