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
The tool will return the contents of the file as a string, along with its size and encoding.
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
		'high-token-usage',
	],
	canBeReferencedInPrompt: false,
	inputSchema: {
		type: 'object',
		properties: {
			filePath: {
				type: 'string',
				description: 'The absolute file path to get the contents of. The file path must be a path to a file in the workspace or a file that is currently open in the editor.',
			},
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
		const { filePath } = invocation.parameters as FileContentsToolParams;

		// Construct the file URI
		let uri: URI | undefined = undefined;
		try {
			uri = getUriForFileOpenOrInsideWorkspace(filePath, this._workspaceContextService, this._editorGroupsService);
		} catch (error) {
			throw new Error(`Can't retrieve file contents: ${error.message}`);
		}

		// The file is in the workspace, so grab the file contents
		const { value, size, encoding } = await this._textFileService.read(uri);

		// If we have a chat context, create a clickable file reference
		if (invocation.context) {
			const model = this._chatService.getSession(invocation.context?.sessionId) as ChatModel;
			const request = model.getRequests().at(-1)!;
			model.acceptResponseProgress(request, {
				kind: 'inlineReference',
				inlineReference: uri,
			});
		}

		return {
			content: [{ kind: 'text', value: JSON.stringify({ contents: value, size, encoding, }) }],
		};
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
}

