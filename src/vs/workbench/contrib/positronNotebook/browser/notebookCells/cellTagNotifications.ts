/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { AddTagResult } from '../PositronNotebookCells/IPositronNotebookCell.js';

/**
 * Surface user feedback for a tag write outcome ({@link AddTagResult}). Used by
 * the inline tag bar's add / edit / remove paths so the result -> notification
 * mapping (and its localized strings) lives in one place and is unit-testable in
 * isolation.
 *
 * `'duplicate'` and `'failed'` show an info toast; `'added'` is silent -- a
 * successful write (or a blank no-op input) needs no toast.
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
