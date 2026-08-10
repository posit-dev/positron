/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IUpdate } from '../../../../platform/update/common/update.js';

/**
 * The distinct notifications a single pending update can produce as it moves
 * through the update state machine. Each one tells the user something
 * different, so each is throttled separately.
 */
export type UpdateNotificationStage = 'availableForDownload' | 'downloaded' | 'ready';

/**
 * Caps update notifications at one per pending version per stage, for the
 * lifetime of a window.
 *
 * The update service can re-enter a notifying state any number of times for
 * the same pending update. On Windows a deadlocked installer does exactly
 * that, which is what produced the notification storm in #15031. Upstream's
 * `shouldShowNotification()` gates on how stale the installed build is, but
 * puts no ceiling on how often it fires once that gate opens; this supplies
 * the ceiling.
 *
 * State is deliberately in-memory and per window. After a reload or a restart
 * the update is still pending and worth mentioning once more.
 */
export class UpdateNotificationThrottle {

	private readonly notified = new Set<string>();

	/**
	 * Returns `true` the first time an update version is seen at a given
	 * stage, and `false` for every repeat within the same window session.
	 */
	shouldNotify(stage: UpdateNotificationStage, update: IUpdate): boolean {
		const version = update.productVersion || update.version;
		const key = `${stage}:${version}`;

		if (this.notified.has(key)) {
			return false;
		}

		this.notified.add(key);
		return true;
	}
}
