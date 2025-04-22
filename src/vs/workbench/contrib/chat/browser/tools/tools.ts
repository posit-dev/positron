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
import { ProjectTreeTool, ProjectTreeToolData } from '../../browser/tools/projectTreeTool.js';
import { TextSearchTool, TextSearchToolData } from './textSearchTool.js';
import { FileContentsTool, FileContentsToolData } from './fileContentsTool.js';

export class PositronBuiltinToolsContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'chat.positronBuiltinTools';

	constructor(
		@ILanguageModelToolsService toolsService: ILanguageModelToolsService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();

		const projectTreeTool = instantiationService.createInstance(ProjectTreeTool);
		this._register(toolsService.registerToolData(ProjectTreeToolData));
		this._register(toolsService.registerToolImplementation(ProjectTreeToolData.id, projectTreeTool));

		const textSearchTool = instantiationService.createInstance(TextSearchTool);
		this._register(toolsService.registerToolData(TextSearchToolData));
		this._register(toolsService.registerToolImplementation(TextSearchToolData.id, textSearchTool));

		const fileContentsTool = instantiationService.createInstance(FileContentsTool);
		this._register(toolsService.registerToolData(FileContentsToolData));
		this._register(toolsService.registerToolImplementation(FileContentsToolData.id, fileContentsTool));
	}
}
