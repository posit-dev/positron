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
 * Determines whether a document URI can be navigated to as editable source
 * text.
 *
 * Navigation opens the URI in a text editor and reveals the source range (see
 * {@link openPlotSource}). This works for plain-text documents such as Quarto
 * `.qmd` files, but not for notebook documents (`.ipynb`), which open in the
 * notebook editor and don't honor a text selection, nor for notebook cell
 * URIs, which can't be opened as text.
 *
 * @param uri The document URI to check.
 * @returns true if the URI can be navigated to as source text; otherwise false.
 */
export function isNavigableSourceUri(uri: URI): boolean {
	// Notebook cell URIs can't be opened as text.
	if (uri.scheme === Schemas.vscodeNotebookCell) {
		return false;
	}
	// Notebook documents open in the notebook editor, which ignores the text
	// selection we'd use to reveal the source.
	if (uri.path.endsWith('.ipynb')) {
		return false;
	}
	return true;
}

/**
 * Builds an editor selection from a plot origin's range, if it has one.
 * Origin ranges are 0-based; editor selections are 1-based.
 */
function selectionFromOrigin(origin: PlotOrigin | undefined): Range | undefined {
	if (!origin?.range) {
		return undefined;
	}
	return new Range(
		origin.range.start_line + 1,
		origin.range.start_character + 1,
		origin.range.end_line + 1,
		origin.range.end_character + 1,
	);
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
		await editorService.openEditor({
			resource: uri,
			options: {
				selection: selectionFromOrigin(origin),
				revealIfVisible: true,
			},
		});
	} catch (err) {
		logService.warn(`Failed to open plot origin file: ${err}`);
	}
}

/**
 * Opens the source document that generated a plot in the editor, revealing the
 * source range if the plot's origin provides one.
 *
 * Unlike {@link openPlotOriginFile}, the document is supplied directly (e.g. a
 * notebook session's document), so it works even when the plot itself carries
 * no origin.
 *
 * @param documentUri The document to open.
 * @param origin The plot's origin, whose range (if any) is revealed.
 * @param editorService The editor service used to open the document.
 * @param logService The log service used for warning on failure.
 */
export async function openPlotSource(
	documentUri: URI,
	origin: PlotOrigin | undefined,
	editorService: IEditorService,
	logService: ILogService
): Promise<void> {
	try {
		await editorService.openEditor({
			resource: documentUri,
			options: {
				selection: selectionFromOrigin(origin),
				revealIfVisible: true,
			},
		});
	} catch (err) {
		logService.warn(`Failed to open plot source document: ${err}`);
	}
}
