/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IntervalTimer } from '../../../../base/common/async.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { ICheckpointsService } from '../../../services/positronCheckpoints/common/checkpointsService.js';
import { CHECKPOINTS_CHECK_SHARED_INTERVAL_KEY } from '../common/checkpointsConfiguration.js';

/** The interval used when the setting does not hold a number. */
const DEFAULT_INTERVAL_MINUTES = 5;

/** The shortest time between two checks that start because the window gained focus. */
const FOCUS_CHECK_MINIMUM_MS = 60 * 1000;

/**
 * Looks for new checkpoints in the shared copy without being asked: when the window gains focus
 * (at most once a minute) and every `checkpoints.checkSharedInterval` minutes. A check changes no
 * files. It is skipped when the project has no shared copy or is in an unusual state, and a
 * failure is logged and never shown.
 */
export class SharedCopyChecker extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.positronCheckpointsSharedCopyChecker';

	private readonly _timer = this._register(new IntervalTimer());
	private _running = false;
	private _lastStartedAt: number | undefined;

	constructor(
		@ICheckpointsService private readonly _checkpointsService: ICheckpointsService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IHostService hostService: IHostService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		this._register(hostService.onDidChangeFocus(focused => {
			if (focused && this._focusCheckAllowed()) {
				void this._check();
			}
		}));
		this._register(this._configurationService.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(CHECKPOINTS_CHECK_SHARED_INTERVAL_KEY)) {
				this._updateTimer();
			}
		}));
		this._register(this._checkpointsService.onDidChangeEngine(() => this._updateTimer()));
		this._updateTimer();
	}

	/** Starts, restarts, or stops the timer from the current engine and setting. */
	private _updateTimer(): void {
		const configured = this._configurationService.getValue<unknown>(CHECKPOINTS_CHECK_SHARED_INTERVAL_KEY);
		const minutes = typeof configured === 'number' && Number.isFinite(configured) ? configured : DEFAULT_INTERVAL_MINUTES;
		if (!this._checkpointsService.hasEngine || minutes <= 0) {
			this._timer.cancel();
			return;
		}
		this._timer.cancelAndSet(() => void this._check(), minutes * 60 * 1000);
	}

	private _focusCheckAllowed(): boolean {
		return this._lastStartedAt === undefined || Date.now() - this._lastStartedAt >= FOCUS_CHECK_MINIMUM_MS;
	}

	/** Runs one check. Does nothing while another check runs. */
	private async _check(): Promise<void> {
		const engine = this._checkpointsService.engine;
		if (!engine || this._running) {
			return;
		}
		this._running = true;
		this._lastStartedAt = Date.now();
		try {
			const state = await engine.getState();
			if (state.tracking !== 'tracking' || !state.shared.exists || state.unusual) {
				return;
			}
			await engine.checkShared();
		} catch (error) {
			this._logService.error('The check of the shared copy failed.', error);
		} finally {
			this._running = false;
		}
	}
}
