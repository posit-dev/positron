/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { isCodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { getContextFromActiveEditor } from '../../notebook/browser/controller/coreActions.js';
import { usingQuartoInlineOutput, isQuartoDocument } from '../../positronQuarto/common/positronQuartoConfig.js';

/**
 * Gets the notebook URI from the active editor. This handles both regular
 * notebook editors and Quarto documents with inline output enabled.
 *
 * @param editorService The editor service
 * @param configurationService The configuration service
 * @returns The notebook URI, or undefined if the active editor is not a notebook
 *   or Quarto document with inline output
 */
export function getNotebookUriFromActiveEditor(
	editorService: IEditorService,
	configurationService: IConfigurationService
): URI | undefined {
	// First, try to get the URI from a notebook editor
	const context = getContextFromActiveEditor(editorService);
	if (context) {
		return context.notebookEditor.textModel.uri;
	}

	// Fall back to checking if the active editor is a Quarto document with
	// inline output enabled
	if (usingQuartoInlineOutput(configurationService)) {
		const editor = editorService.activeTextEditorControl;
		if (isCodeEditor(editor)) {
			const model = editor.getModel();
			if (model && isQuartoDocument(model.uri.path, model.getLanguageId())) {
				return model.uri;
			}
		}
	}

	return undefined;
}
