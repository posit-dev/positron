/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IActivityService, NumberBadge } from '../../../services/activity/common/activity.js';
import { ICheckpointsService } from '../../../services/positronCheckpoints/common/checkpointsService.js';
import { Strings } from '../common/checkpointsStrings.js';

/** The id of the Version History view container, whose activity bar icon gets the badge. */
const VIEW_CONTAINER_ID = 'workbench.view.positronCheckpoints';

/**
 * Shows the number of new versions in the shared copy as a badge on the Version History icon
 * of the activity bar, so a person who has another view open sees that colleagues added work.
 * The count is read from the engine each time its state changes. There is no badge while the
 * project has everything, has no shared copy, or has no engine.
 */
export class IncomingChangesBadge extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.positronCheckpointsIncomingChangesBadge';

	private readonly _badge = this._register(new MutableDisposable());
	private _shownCount = 0;
	/** Counts the reads, so an older read that ends late does not replace a newer one. */
	private _readId = 0;

	constructor(
		@ICheckpointsService private readonly _checkpointsService: ICheckpointsService,
		@IActivityService private readonly _activityService: IActivityService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		this._register(this._checkpointsService.onDidChangeEngine(() => void this._update()));
		this._register(this._checkpointsService.onDidChangeState(() => void this._update()));
		void this._update();
	}

	private async _update(): Promise<void> {
		const readId = ++this._readId;
		let count = 0;
		const engine = this._checkpointsService.engine;
		if (engine) {
			try {
				const state = await engine.getState();
				count = state.tracking === 'tracking' && state.shared.exists ? state.shared.behind : 0;
			} catch (error) {
				this._logService.warn('[Checkpoints] The count of new versions in the shared copy could not be read.', error);
				return;
			}
		}
		if (readId !== this._readId || this._store.isDisposed || count === this._shownCount) {
			return;
		}
		this._shownCount = count;
		this._badge.value = count > 0
			? this._activityService.showViewContainerActivity(VIEW_CONTAINER_ID, { badge: new NumberBadge(count, shown => Strings.status.incomingWithoutAuthor(shown)) })
			: undefined;
	}
}
