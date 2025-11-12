/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { IChatWidgetLocationOptions } from '../../chat/browser/chatWidget.js';
import { ChatAgentLocation } from '../../chat/common/constants.js';
import { IPositronNotebookService } from '../../positronNotebook/browser/positronNotebookService.js';

/**
 * Update the location to Notebook if the given editor is part of a Positron
 * notebook. This allows the request to get routed to the correct notebook
 * participant which otherwise wouldnt happen because the location is
 * EditorInline. We could fix this at a different layer but this is the least
 * invasive way I've found to do it.
 *
 * @param editor The code editor to check
 * @param location The chat widget location to update
 * @param positronNotebookService The Positron notebook service
 * @returns true if the editor is part of a Positron notebook, false otherwise
 */
export function updateLocationForPositronNotebooks(
	editor: ICodeEditor,
	location: IChatWidgetLocationOptions,
	positronNotebookService: IPositronNotebookService
): boolean {
	for (const positronInstance of positronNotebookService.listInstances()) {
		if (positronInstance.hasCodeEditor(editor)) {
			location.location = ChatAgentLocation.Notebook;
			return true;
		}
	}
	return false;
}

