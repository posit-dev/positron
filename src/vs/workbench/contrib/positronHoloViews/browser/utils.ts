/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILanguageRuntimeMessageOutput } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { MIME_TYPE_HOLOVIEWS_LOAD, MIME_TYPE_HOLOVIEWS_EXEC } from 'vs/workbench/services/positronHoloViews/common/positronHoloViewsService';

/**
 * Check if a message represents a holoviews message.
 * @param msg Message from language runtime.
 * @returns True if the message is a holoviews message.
 */
export function isHoloViewsMessage(msg: ILanguageRuntimeMessageOutput): boolean {
	return MIME_TYPE_HOLOVIEWS_LOAD in msg.data || MIME_TYPE_HOLOVIEWS_EXEC in msg.data;
}
