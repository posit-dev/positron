/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { Range } from '../../../../editor/common/core/range.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { PlotOrigin } from '../../../services/languageRuntime/common/positronPlotComm.js';

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
