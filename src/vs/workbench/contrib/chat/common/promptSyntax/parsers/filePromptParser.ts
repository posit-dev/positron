/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../../base/common/uri.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { BasePromptParser, IPromptParserOptions } from './basePromptParser.js';
import { FilePromptContentProvider } from '../contentProviders/filePromptContentsProvider.js';
import { IWorkspaceContextService } from '../../../../../../platform/workspace/common/workspace.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';

/**
 * Class capable of parsing prompt syntax out of a provided file,
 * including all the nested child file references it may have.
 */
export class FilePromptParser extends BasePromptParser<FilePromptContentProvider> {
	constructor(
		uri: URI,
		options: Partial<IPromptParserOptions> = {},
		@IInstantiationService initService: IInstantiationService,
		@IWorkspaceContextService workspaceService: IWorkspaceContextService,
		@ILogService logService: ILogService,
	) {
		const contentsProvider = initService.createInstance(FilePromptContentProvider, uri, options);
		super(contentsProvider, options, initService, workspaceService, logService);

		this._register(contentsProvider);
	}

	/**
	 * Returns a string representation of this object.
	 */
	public override toString() {
		return `file-prompt:${this.uri.path}`;
	}
}
