/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as glob from '../../../../../base/common/glob.js';
import { basename, isAbsolute } from '../../../../../base/common/path.js';
import { isEqual } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { GroupsOrder, IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';

/**
 * Constructs a URI for a file path that is either absolute or relative to the workspace.
 * The file must either be open in an editor or inside a folder within the workspace.
 * @param filePath The file path to check. It can be either absolute or relative.
 * @param workspaceContextService The workspace context service
 * @param editorGroupsService The editor groups service
 * @returns The URI of the file or throws an error if the file is not open or inside the workspace.
 */
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

/**
 * Checks if a file is open in any editor or inside the workspace.
 * @param uri The URI of the file to check
 * @param workspaceContextService The workspace context service
 * @param editorGroupsService The editor groups service
 * @returns Whether the file is open in any editor or inside the workspace
 */
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

/**
 * Checks if a file path should be excluded from AI features based on aiExcludes settings.
 * Uses aiExcludes; only falls back to the deprecated inlineCompletionExcludes when the user
 * explicitly set it (migration aid). Otherwise the contributed aiExcludes default applies.
 * For patterns without '/', matches against basename only for intuitive behavior.
 * @param configurationService The configuration service
 * @param filePath The full file path to check (uri.path)
 * @returns Whether the file is excluded from AI features
 */
export function isFileExcludedFromAI(configurationService: IConfigurationService, filePath: string): boolean {
	// `inspect()` reports user-written values in `userValue` / `workspaceValue`;
	// the contributed default lives in a separate `defaultValue` field. Checking
	// `!== undefined` (not truthy) is deliberate: an empty array is still a user
	// value and means "user said exclude nothing," which must not be overridden.
	const aiInspect = configurationService.inspect<string[]>('positron.assistant.aiExcludes');
	const inlineInspect = configurationService.inspect<string[]>('positron.assistant.inlineCompletionExcludes');
	const aiSetByUser = aiInspect?.userValue !== undefined || aiInspect?.workspaceValue !== undefined;
	const inlineSetByUser = inlineInspect?.userValue !== undefined || inlineInspect?.workspaceValue !== undefined;

	// Honor the deprecated `inlineCompletionExcludes` only as a migration aid:
	// the user explicitly set it and hasn't moved to `aiExcludes` yet. Stock
	// users fall through to the `aiExcludes` contributed default via `.getValue()`.
	const patterns = (!aiSetByUser && inlineSetByUser)
		? configurationService.getValue<string[]>('positron.assistant.inlineCompletionExcludes')
		: configurationService.getValue<string[]>('positron.assistant.aiExcludes');

	if (!patterns || patterns.length === 0) {
		return false;
	}

	return patterns.some(pattern => {
		if (!pattern.includes('/')) {
			return glob.match(pattern, basename(filePath));
		}
		return glob.match(pattern, filePath);
	});
}
