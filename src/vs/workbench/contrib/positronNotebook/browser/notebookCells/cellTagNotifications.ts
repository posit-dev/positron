/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { AddTagResult } from '../PositronNotebookCells/IPositronNotebookCell.js';

/**
 * Surface user feedback for a tag write outcome ({@link AddTagResult}). Shared by
 * the inline tag bar and the "Add Tag" command so the result -> notification
 * mapping (and its localized strings) lives in one place.
 *
 * `'duplicate'` and `'failed'` show an info toast; `'added'` and `'empty'` are
 * silent -- a successful write needs no toast, and a blank input just closes.
 */
export function notifyTagResult(notificationService: INotificationService, result: AddTagResult, tag: string): void {
	if (result === 'duplicate') {
		notificationService.info(
			localize('positron.notebook.cellTag.duplicate', "Tag '{0}' is already on this cell.", tag)
		);
	} else if (result === 'failed') {
		notificationService.info(
			localize('positron.notebook.cellTag.writeFailed', "Could not update the cell's tags.")
		);
	}
}
