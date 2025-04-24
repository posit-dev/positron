/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { localize } from '../../../../../nls.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { ITextQueryBuilderOptions, QueryBuilder } from '../../../../services/search/common/queryBuilder.js';
import { ISearchConfigurationProperties, ISearchService } from '../../../../services/search/common/search.js';
import { CountTokensCallback, IPreparedToolInvocation, IToolData, IToolImpl, IToolInvocation, IToolResult } from '../../common/languageModelToolsService.js';
import { IToolInputProcessor } from '../../common/tools/tools.js';

const findTextInProjectModelDescription = `
This tool searches for the case-insensitive specified text in the project and returns a set of files and their corresponding lines where the text is found.
The search is performed across all files in the project, excluding files and directories that are ignored by the workspace settings.
`;

export const ExtensionTextSearchToolId = 'positron_findTextInProject';
export const InternalTextSearchToolId = `${ExtensionTextSearchToolId}_internal`;
export const TextSearchToolData: IToolData = {
	id: InternalTextSearchToolId,
	displayName: localize('chat.tools.findTextInProject', "Find Text In Project"),
	source: { type: 'internal' },
	modelDescription: findTextInProjectModelDescription,
	tags: ['positron-assistant'],
	canBeReferencedInPrompt: false,
	inputSchema: {
		type: 'object',
		properties: {
			textToFind: {
				type: 'string',
				description: 'The exact case-insensitive text to find in the project.',
			},
		},
		required: ['textToFind']
	}
};

export class TextSearchTool implements IToolImpl {
	private readonly _queryBuilder = this._instantiationService.createInstance(QueryBuilder);

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ISearchService private readonly _searchService: ISearchService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
	) { }

	private get searchConfig(): ISearchConfigurationProperties {
		return this._configurationService.getValue<ISearchConfigurationProperties>('search');
	}

	async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, _token: CancellationToken): Promise<IToolResult> {
		const workspaceFolders = this._workspaceContextService.getWorkspace().folders;
		if (workspaceFolders.length === 0) {
			return {
				content: [],
				toolResultMessage: 'No workspace folders found.'
			};
		}

		const { textToFind } = invocation.parameters as TextSearchToolParams;
		const workspaceUris = workspaceFolders.map(folder => folder.uri);
		const queryOptions: ITextQueryBuilderOptions = {
			_reason: InternalTextSearchToolId,
			maxResults: this.searchConfig.maxResults ?? undefined,
			isSmartCase: this.searchConfig.smartCase ?? undefined,
			disregardIgnoreFiles: this.searchConfig.useIgnoreFiles ? false : undefined,
			disregardExcludeSettings: false,
			onlyOpenEditors: false,
		};

		const content = {
			pattern: textToFind
		};
		const query = this._queryBuilder.text(content, workspaceUris, queryOptions);
		const { results } = await this._searchService.textSearch(query, _token);

		return {
			content: results.map(result => ({ kind: 'text', value: JSON.stringify(({ file: result.resource.path, results: result.results })) })),
		};
	}

	async prepareToolInvocation(_parameters: any, _token: CancellationToken): Promise<IPreparedToolInvocation> {
		return {
			invocationMessage: localize('textSearchTool.invocationMessage', "Searching for text in project"),
			pastTenseMessage: localize('textSearchTool.pastTenseMessage', "Searched for text in project"),
		};
	}
}

export interface TextSearchToolParams {
	textToFind: string;
}

export class TextSearchToolInputProcessor implements IToolInputProcessor {
	processInput(input: TextSearchToolParams) {
		// No input processing needed for this tool
		return input;
	}
}
