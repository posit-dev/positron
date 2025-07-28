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
import { IPatternInfo, ISearchConfigurationProperties, ISearchService, resultIsMatch } from '../../../../services/search/common/search.js';
import { CountTokensCallback, IPreparedToolInvocation, IToolData, IToolImpl, IToolInvocation, IToolResult, ToolDataSource, ToolProgress } from '../../common/languageModelToolsService.js';
import { ChatModel } from '../../common/chatModel.js';
import { IChatService } from '../../common/chatService.js';

const DEFAULT_MAX_RESULTS = 50;

const findTextInProjectModelDescription = `
This tool searches for the specified text inside files in the project and returns a set of files and their corresponding lines where the text is found,
as well as messages about the search results.
DO NOT use this tool to find files or directories in the workspace, as it is specifically designed for searching text within files.
The search is performed across all files in the project, excluding files and directories that are ignored by the workspace settings.
Other search options such as case sensitivity, whole word matching, and multiline matching can be specified.
`;

export const ExtensionTextSearchToolId = 'positron_findTextInProject';
export const InternalTextSearchToolId = `${ExtensionTextSearchToolId}_internal`;
export const TextSearchToolData: IToolData = {
	id: InternalTextSearchToolId,
	displayName: localize('chat.tools.findTextInProject', "Find Text In Project"),
	source: ToolDataSource.Internal,
	modelDescription: findTextInProjectModelDescription,
	tags: [
		'positron-assistant',
		'requires-workspace',
		'high-token-usage',
	],
	canBeReferencedInPrompt: false,
	inputSchema: {
		type: 'object',
		properties: {
			pattern: {
				type: 'string',
				description: 'The text pattern to search for in the project. This pattern is interpreted as text unless isRegExp is set to true.',
			},
			isRegExp: {
				type: 'boolean',
				description: 'Whether the search pattern is a regular expression.',
			},
			isWordMatch: {
				type: 'boolean',
				description: 'Whether the search pattern should match whole words only.',
			},
			wordSeparators: {
				type: 'string',
				description: 'A string of characters that are considered word separators.',
			},
			isMultiline: {
				type: 'boolean',
				description: 'Whether the search pattern should match across multiple lines.',
			},
			isUnicode: {
				type: 'boolean',
				description: 'Whether the search pattern should be treated as a Unicode string.',
			},
			isCaseSensitive: {
				type: 'boolean',
				description: 'Whether the search pattern should be case-sensitive.',
			},
			maxResults: {
				type: 'number',
				description: `The maximum number of search results to return. Cannot exceed the default maximum of ${DEFAULT_MAX_RESULTS} to prevent excessive token usage.`,
				default: DEFAULT_MAX_RESULTS
			}
			// Not included here: notebookInfo. See the IPatternInfo interface in src/vs/workbench/services/search/common/search.ts
		},
		required: ['pattern'],
	}
};

export class TextSearchTool implements IToolImpl {
	private readonly _queryBuilder = this._instantiationService.createInstance(QueryBuilder);

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ISearchService private readonly _searchService: ISearchService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IChatService private readonly _chatService: IChatService,
	) { }

	private get searchConfig(): ISearchConfigurationProperties {
		return this._configurationService.getValue<ISearchConfigurationProperties>('search');
	}

	async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress, _token: CancellationToken): Promise<IToolResult> {
		const workspaceFolders = this._workspaceContextService.getWorkspace().folders;
		if (workspaceFolders.length === 0) {
			throw new Error(`Can't search for text in project because no workspace folders are open. Open a workspace folder before using this tool.`);
		}

		// Set up the text search query
		const searchParams = invocation.parameters as TextSearchToolParams;
		const workspaceUris = workspaceFolders.map(folder => folder.uri);
		// Don't allow more than the default max results, even if a higher value is provided,
		// to prevent excessive token usage and performance issues.
		const maxResults = searchParams.maxResults && searchParams.maxResults < DEFAULT_MAX_RESULTS
			? searchParams.maxResults
			: DEFAULT_MAX_RESULTS;
		const queryOptions: ITextQueryBuilderOptions = {
			_reason: InternalTextSearchToolId,
			maxResults,
			isSmartCase: this.searchConfig.smartCase ?? undefined,
			disregardIgnoreFiles: this.searchConfig.useIgnoreFiles ? false : undefined,
			disregardExcludeSettings: false,
			onlyOpenEditors: false,
		};
		const query = this._queryBuilder.text(searchParams, workspaceUris, queryOptions);

		// Search for the text
		const { results, messages, limitHit } = await this._searchService.textSearch(query, _token);

		// If we have a chat context, include references for each result
		if (invocation.context) {
			const model = this._chatService.getSession(invocation.context.sessionId) as ChatModel;
			const request = model.getRequests().at(-1)!;

			for (const result of results) {
				const { resource, results: fileMatches } = result;
				if (!fileMatches?.length) {
					continue; // No results for this file
				}

				fileMatches
					.filter(resultIsMatch)
					.flatMap(match => match.rangeLocations)
					.forEach(loc => {
						model.acceptResponseProgress(request, {
							kind: 'reference',
							reference: {
								uri: resource,
								// Adjust the range to be 1-based for display (ranges are 0-based in the results)
								range: {
									startLineNumber: loc.source.startLineNumber + 1,
									startColumn: loc.source.startColumn + 1,
									endLineNumber: loc.source.endLineNumber + 1,
									endColumn: loc.source.endColumn + 1
								}
							}
						});
					});
			}
		}

		const response: any = {
			results,
			messages,
		};
		if (limitHit) {
			response.hitMaxResults = `Hit the maximum number of results: ${maxResults}.`;
		}

		return {
			content: [{
				kind: 'text',
				value: JSON.stringify(response),
			}],
		};
	}

	async prepareToolInvocation(_parameters: any, _token: CancellationToken): Promise<IPreparedToolInvocation> {
		return {
			invocationMessage: localize('textSearchTool.invocationMessage', "Searching for text in project"),
			pastTenseMessage: localize('textSearchTool.pastTenseMessage', "Searched for text in project"),
		};
	}
}

export interface TextSearchToolParams extends IPatternInfo {
	maxResults: number;
}
