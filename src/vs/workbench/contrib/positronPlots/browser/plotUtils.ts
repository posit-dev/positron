/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import { Range } from '../../../../editor/common/core/range.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { PlotOrigin } from '../../../services/languageRuntime/common/positronPlotComm.js';

/**
 * Determines whether a plot's origin can be navigated to by opening it in the
 * editor.
 *
 * Navigation opens the origin URI in a text editor and reveals the source
 * range (see {@link openPlotOriginFile}). This works for text documents (e.g.
 * `.py`, `.R`, `.qmd`), but not for notebooks (`.ipynb`), which open in the
 * notebook editor and don't honor a text selection, nor for notebook cell
 * URIs, which can't be opened as text.
 *
 * @param origin The plot origin to check.
 * @returns true if the origin can be navigated to; otherwise false.
 */
export function isPlotOriginNavigable(origin: PlotOrigin | undefined): boolean {
	if (!origin?.uri) {
		return false;
	}
	try {
		const uri = URI.parse(origin.uri);
		// Notebook cell URIs can't be opened as text.
		if (uri.scheme === Schemas.vscodeNotebookCell) {
			return false;
		}
		// Notebook documents open in the notebook editor, which ignores the
		// text selection we'd use to reveal the source.
		if (uri.path.endsWith('.ipynb')) {
			return false;
		}
		return true;
	} catch {
		return false;
	}
}

/**
 * Opens the source file associated with a plot's origin in the editor.
 *
 * @param origin The plot origin containing the URI and optional range.
 * @param editorService The editor service used to open the file.
 * @param logService The log service used for warning on failure.
 */
export async function openPlotOriginFile(
	origin: PlotOrigin | undefined,
	editorService: IEditorService,
	logService: ILogService
): Promise<void> {
	if (!origin?.uri) {
		return;
	}
	try {
		const uri = URI.parse(origin.uri);
		const selection = origin.range
			? new Range(
				origin.range.start_line + 1,
				origin.range.start_character + 1,
				origin.range.end_line + 1,
				origin.range.end_character + 1,
			)
			: undefined;
		await editorService.openEditor({
			resource: uri,
			options: {
				selection,
				revealIfVisible: true,
			},
		});
	} catch (err) {
		logService.warn(`Failed to open plot origin file: ${err}`);
	}
}
