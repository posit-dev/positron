/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';
import { ITextFileService } from '../../../../services/textfile/common/textfiles.js';
import { ChatModel } from '../../common/chatModel.js';
import { IChatService } from '../../common/chatService.js';
import { CountTokensCallback, IPreparedToolInvocation, IToolData, IToolImpl, IToolInvocation, IToolResult, ToolDataSource, ToolProgress } from '../../common/languageModelToolsService.js';
import { getUriForFileOpenOrInsideWorkspace } from './utils.js';

const getFileContentsModelDescription = `
This tool returns the contents of the specified file in the project.
`;

export const ExtensionFileContentsToolId = 'positron_getFileContents';
export const InternalFileContentsToolId = `${ExtensionFileContentsToolId}_internal`;
export const FileContentsToolData: IToolData = {
	id: InternalFileContentsToolId,
	displayName: localize('chat.tools.getFileContents', "Get File Contents"),
	source: ToolDataSource.Internal,
	modelDescription: getFileContentsModelDescription,
	tags: [
		'positron-assistant',
		'requires-workspace',
	],
	canBeReferencedInPrompt: false,
	inputSchema: {
		type: 'object',
		properties: {
			filePath: {
				// --- Start Positron ---
				type: 'string',
				description: 'The file path to get the contents of. Only use absolute paths if you are sure the file you are retrieving is outside of the current workspace, otherwise use relative paths.',
			},
			lines: {
				type: 'array',
				items: { type: 'number' },
				minItems: 2,
				maxItems: 2,
				description: 'Optional line range [start, end] to read (1-indexed, inclusive). If omitted, file must be <=500 lines.',
			},
			// --- End Positron ---
		},
		required: ['filePath']
	}
};

export class FileContentsTool implements IToolImpl {
	constructor(
		@IChatService private readonly _chatService: IChatService,
		@ITextFileService private readonly _textFileService: ITextFileService,
		@IEditorGroupsService private readonly _editorGroupsService: IEditorGroupsService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
	) { }

	async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress, _token: CancellationToken): Promise<IToolResult> {
		// --- Start Positron ---
		const { filePath, lines } = invocation.parameters as FileContentsToolParams;
		// --- End Positron ---

		// Construct the file URI
		let uri: URI | undefined = undefined;
		try {
			uri = getUriForFileOpenOrInsideWorkspace(filePath, this._workspaceContextService, this._editorGroupsService);
		} catch (error) {
			throw new Error(`Can't retrieve file contents: ${error.message}`);
		}

		// The file is in the workspace, so grab the file contents
		// --- Start Positron ---
		const { value, encoding } = await this._textFileService.read(uri);
		// Count lines and validate
		const allLines = value.split('\n');
		const totalLines = allLines.length;

		// If no line range specified and file is too large, error
		if (!lines && totalLines > 500) {
			const fileName = uri.path.split('/').pop() || uri.path;
			throw new Error(
				`Error: file ${fileName} contains ${totalLines} lines and is too large (>500 lines) to return here. ` +
				`Set the \`lines\` argument to read a subset of lines. Try lines: [1, 500]`
			);
		}

		// Apply line range if specified
		let contentsToReturn: string;
		let startLine: number;
		let endLine: number;

		if (lines) {
			const [requestedStart, requestedEnd] = lines;

			// Validate line numbers (1-indexed input)
			if (requestedStart < 1) {
				throw new Error(`Start line must be >=1, got ${requestedStart}`);
			}
			if (requestedEnd < requestedStart) {
				throw new Error(`End line (${requestedEnd}) must be >= start line (${requestedStart})`);
			}

			// Convert to 0-indexed, clamp endLine to totalLines
			const start = requestedStart - 1;
			const end = Math.min(requestedEnd, totalLines);

			// Slice and rejoin
			contentsToReturn = allLines.slice(start, end).join('\n');
			startLine = requestedStart;
			endLine = end;
		} else {
			contentsToReturn = value;
			startLine = 1;
			endLine = totalLines;
		}
		// --- End Positron ---

		// If we have a chat context, create a clickable file reference
		if (invocation.context) {
			const model = this._chatService.getSession(invocation.context?.sessionId) as ChatModel;
			const request = model.getRequests().at(-1)!;
			model.acceptResponseProgress(request, {
				kind: 'inlineReference',
				inlineReference: uri,
			});
		}

		// --- Start Positron ---
		return {
			content: [{
				kind: 'text', value: JSON.stringify({
					contents: contentsToReturn,
					startLine,
					endLine,
					totalLines,
					encoding,
				})
			}],
		};
		// --- End Positron ---
	}

	async prepareToolInvocation(_parameters: any, _token: CancellationToken): Promise<IPreparedToolInvocation> {
		return {
			invocationMessage: localize('fileContentsTool.invocationMessage', "Retrieving file contents"),
			pastTenseMessage: localize('fileContentsTool.pastTenseMessage', "Retrieved file contents"),
		};
	}
}

export interface FileContentsToolParams {
	filePath: string;
	// --- Start Positron ---
	lines?: [number, number];
	// --- End Positron ---
}
