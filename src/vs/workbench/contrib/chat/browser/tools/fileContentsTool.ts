/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { isAbsolute } from '../../../../../base/common/path.js';
import { isEqual } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { GroupsOrder, IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';
import { ITextFileService } from '../../../../services/textfile/common/textfiles.js';
import { ChatModel } from '../../common/chatModel.js';
import { IChatService } from '../../common/chatService.js';
import { CountTokensCallback, IPreparedToolInvocation, IToolData, IToolImpl, IToolInvocation, IToolResult, ToolProgress } from '../../common/languageModelToolsService.js';

const getFileContentsModelDescription = `
This tool returns the contents of the specified file in the project.
The provided file path must be a path to a file in the workspace or a file that is currently open in the editor.
The file path can be either absolute or relative to the workspace root.
The tool will return the contents of the file as a string, along with its size and encoding.
Do not use this tool when no workspace folders are open.
`;

export const ExtensionFileContentsToolId = 'positron_getFileContents';
export const InternalFileContentsToolId = `${ExtensionFileContentsToolId}_internal`;
export const FileContentsToolData: IToolData = {
	id: InternalFileContentsToolId,
	displayName: localize('chat.tools.getFileContents', "Get File Contents"),
	source: { type: 'internal' },
	modelDescription: getFileContentsModelDescription,
	tags: ['positron-assistant'],
	canBeReferencedInPrompt: false,
	inputSchema: {
		type: 'object',
		properties: {
			filePath: {
				type: 'string',
				description: 'The file path to get the contents of.',
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
		if (isAbsolute(filePath)) {
			uri = URI.file(filePath);
			if (!this.fileIsOpenOrInsideWorkspace(uri)) {
				throw new Error(`Can't retrieve file contents for ${filePath} because the file is not open or inside the current workspace`);
			}
		} else {
			// If the file path is relative, try to resolve it against the workspace folders
			const workspaceFolders = this._workspaceContextService.getWorkspace().folders;
			for (const folder of workspaceFolders) {
				const resolvedUri = folder.toResource(filePath);
				if (this.fileIsOpenOrInsideWorkspace(resolvedUri)) {
					uri = resolvedUri;
					break;
				}
			}
			if (!uri) {
				throw new Error(`Can't retrieve file contents for ${filePath} because the file is not open or inside the current workspace`);
			}
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

	fileIsOpenOrInsideWorkspace(uri: URI): boolean {
		// Check if the file is inside the workspace
		if (this._workspaceContextService.isInsideWorkspace(uri)) {
			return true;
		}

		// Otherwise, check if the file is open in any editor
		const groupsByLastActive = this._editorGroupsService.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE);
		return groupsByLastActive.some((group) => {
			return group.editors.some((editor) => {
				return isEqual(editor.resource, uri);
			});
		});
	}
}

export interface FileContentsToolParams {
	filePath: string;
}

