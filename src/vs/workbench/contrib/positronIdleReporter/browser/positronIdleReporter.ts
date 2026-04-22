/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../base/browser/window.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { POSITRON_IDLE_TRACKING_CHANNEL_NAME, PositronIdleTrackingChannelClient } from '../../../../platform/positronIdleTracking/common/positronIdleTrackingIpc.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IRemoteAgentService } from '../../../services/remote/common/remoteAgentService.js';
import { IUserActivityService } from '../../../services/userActivity/common/userActivityService.js';

/** Interval at which heartbeats are sent while the user is active. */
const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Browser workbench contribution that forwards user activity state to the
 * server via IPC. This allows the server to track how long the user has been
 * idle, which hosting platforms like Posit Cloud can query via the /idle
 * HTTP endpoint.
 *
 * Only activates when a remote connection exists (i.e., web/server mode).
 */
class PositronIdleReporterContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.positronIdleReporter';

	private readonly _clientId = generateUuid();
	private readonly _heartbeatTimer = this._register(new MutableDisposable());

	constructor(
		@IRemoteAgentService remoteAgentService: IRemoteAgentService,
		@IUserActivityService userActivityService: IUserActivityService,
	) {
		super();

		const connection = remoteAgentService.getConnection();
		if (!connection) {
			// Not in a remote/server context; nothing to do.
			return;
		}

		const channel = new PositronIdleTrackingChannelClient(
			connection.getChannel(POSITRON_IDLE_TRACKING_CHANNEL_NAME)
		);

		// Report activity immediately on startup since the user just opened the
		// window (which is itself an activity signal).
		channel.reportActivity(this._clientId, Date.now());

		// When the user becomes active, report it and start periodic heartbeats.
		// When the user becomes inactive, stop heartbeats (the server's idle
		// timer will naturally grow from the last reported timestamp).
		this._register(userActivityService.onDidChangeIsActive(isActive => {
			if (isActive) {
				channel.reportActivity(this._clientId, Date.now());
				this._startHeartbeat(channel);
			} else {
				this._heartbeatTimer.clear();
			}
		}));

		// If already active at construction time, start heartbeats.
		if (userActivityService.isActive) {
			this._startHeartbeat(channel);
		}
	}

	private _startHeartbeat(channel: PositronIdleTrackingChannelClient): void {
		const timer = mainWindow.setInterval(() => {
			channel.reportActivity(this._clientId, Date.now());
		}, HEARTBEAT_INTERVAL_MS);

		this._heartbeatTimer.value = { dispose: () => mainWindow.clearInterval(timer) };
	}
}

registerWorkbenchContribution2(
	PositronIdleReporterContribution.ID,
	PositronIdleReporterContribution,
	WorkbenchPhase.Eventually,
);
