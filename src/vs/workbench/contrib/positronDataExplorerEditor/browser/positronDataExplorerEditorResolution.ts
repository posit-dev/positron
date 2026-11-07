/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { posix } from '../../../../base/common/path.js';
import { extname } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';

/**
 * Finds a Data Explorer editor that is already open for a resource and brings it to the target
 * group, as the editor resolver does for a single-per-resource editor.
 *
 * The resolver can't do this itself for a data file: it looks for open editors by the file's URI,
 * while a Data Explorer tab's resource is its Data Explorer URI. Without this, opening a file whose
 * Data Explorer tab is open in another group would open a second tab over the same Data Explorer.
 *
 * @param resource The Data Explorer URI of the editor to find.
 * @param group The group the editor is being opened in.
 * @param editorService The editor service.
 * @param editorGroupsService The editor groups service.
 * @returns The open editor, now in the target group, or undefined if none is open.
 */
export function moveOpenDataExplorerEditorToGroup(
	resource: URI,
	group: IEditorGroup,
	editorService: IEditorService,
	editorGroupsService: IEditorGroupsService
): EditorInput | undefined {
	const openEditors = editorService.findEditors(resource);

	// Reuse the editor where it is if it's already open in the target group.
	const inGroup = openEditors.find(openEditor => openEditor.groupId === group.id);
	if (inGroup) {
		return inGroup.editor;
	}

	// Otherwise move it from the group it's open in.
	const [openEditor] = openEditors;
	if (!openEditor) {
		return undefined;
	}
	editorGroupsService.getGroup(openEditor.groupId)?.moveEditor(openEditor.editor, group);
	return openEditor.editor;
}

/** File extensions DuckDB reads without a DuckDB extension download. */
export const DUCKDB_BUILTIN_EXTENSIONS = ['parquet', 'parq', 'csv', 'tsv', 'gz', 'xlsx'];

/**
 * Whether the Data Explorer can open a file with DuckDB.
 *
 * @param resource The file.
 * @param readerExtensions Extensions from `dataExplorer.fileReaders` (lower case, no dot).
 */
export function canOpenWithDuckDB(resource: URI, readerExtensions: readonly string[]): boolean {
	// Editor registration globs match case-insensitively, so compare case-insensitively here too.
	const fileExt = extname(resource).substring(1).toLowerCase();
	if (readerExtensions.includes(fileExt)) {
		return true;
	}
	if (fileExt === 'gz') {
		// Strip the .gz and check the inner extension.
		const innerExt = posix.extname(resource.path.slice(0, -3)).substring(1).toLowerCase();
		return DUCKDB_BUILTIN_EXTENSIONS.includes(innerExt);
	}
	return DUCKDB_BUILTIN_EXTENSIONS.includes(fileExt);
}
