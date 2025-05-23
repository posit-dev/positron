/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { isAbsolute } from '../../../../../base/common/path.js';
import { isEqual } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { GroupsOrder, IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';

export function getUriForFileOpenOrInsideWorkspace(
	filePath: string,
	workspaceContextService: IWorkspaceContextService,
	editorGroupsService: IEditorGroupsService,
): URI {
	let uri: URI | undefined = undefined;
	if (isAbsolute(filePath)) {
		uri = URI.file(filePath);
		if (!fileIsOpenOrInsideWorkspace(uri, workspaceContextService, editorGroupsService)) {
			throw new Error(`Absolute file path "${filePath}" is not inside the workspace or open in an editor.`);
		}
	} else {
		// If the file path is relative, try to resolve it against the workspace folders
		const workspaceFolders = workspaceContextService.getWorkspace().folders;
		for (const folder of workspaceFolders) {
			let relativePath = filePath;
			// This is kinda whack, but in a multi-root workspace, we need to check if the relative path starts
			// with the folder name to avoid constructing a URI that has the folder name twice.
			// For example, if the folder is "myFolder" and the relative path is "myFolder/src/file.txt",
			// we want to construct "myFolder/src/file.txt" instead of "myFolder/myFolder/src/file.txt".
			if (workspaceFolders.length > 1) {
				const folderName = folder.name;
				if (relativePath.startsWith(folderName + '/') || relativePath.startsWith(folderName + '\\')) {
					relativePath = relativePath.slice(folderName.length + 1);
				} else {
					// If the filePath does not start with this folder's name, skip to next folder
					continue;
				}
			}
			const resolvedUri = folder.toResource(relativePath);
			if (fileIsOpenOrInsideWorkspace(resolvedUri, workspaceContextService, editorGroupsService)) {
				uri = resolvedUri;
				break;
			}
		}
		if (!uri) {
			throw new Error(`Relative file path "${filePath}" is not inside the workspace or open in an editor.`);
		}
	}
	return uri;
}

function fileIsOpenOrInsideWorkspace(
	uri: URI,
	workspaceContextService: IWorkspaceContextService,
	editorGroupsService: IEditorGroupsService,
): boolean {
	// Check if the file is inside the workspace
	if (workspaceContextService.isInsideWorkspace(uri)) {
		return true;
	}

	// Otherwise, check if the file is open in any editor
	const groupsByLastActive = editorGroupsService.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE);
	return groupsByLastActive.some((group) => {
		return group.editors.some((editor) => {
			return isEqual(editor.resource, uri);
		});
	});
}
