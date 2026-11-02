/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// --- Start PWB: Stop reconnecting once Workbench reports the session exited (rstudio-pro#13201) ---
import * as dom from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { PersistentConnection, PersistentConnectionEvent, PersistentConnectionEventType } from '../../../../platform/remote/common/remoteAgentConnection.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IRemoteAgentService } from '../../../services/remote/common/remoteAgentService.js';

/** Window event dispatched by rsLoginCheck.js; must match `rs_publishSessionExited`. */
export const PWB_SESSION_EXITED_EVENT = 'pwb-session-exited';

/**
 * Calls `stopReconnecting` once, when the session has exited and the remote connection is lost.
 */
export class PwbSessionExitWatcher extends Disposable {
	private _sessionExited = false;
	private _connectionLost = false;
	private _stopped = false;

	constructor(
		onDidStateChange: Event<PersistentConnectionEvent>,
		private readonly _stopReconnecting: () => void,
	) {
		super();
		this._register(onDidStateChange(e => {
			// Wait/Running events only occur while reconnecting, so they also prove the connection is
			// lost. That covers a ConnectionLost fired before this watcher subscribed (events don't replay).
			if (e.type === PersistentConnectionEventType.ConnectionLost
				|| e.type === PersistentConnectionEventType.ReconnectionWait
				|| e.type === PersistentConnectionEventType.ReconnectionRunning) {
				this._connectionLost = true;
			} else if (e.type === PersistentConnectionEventType.ConnectionGain) {
				this._connectionLost = false;
			}
			this._maybeStop();
		}));
	}

	setSessionExited(exited: boolean | undefined): void {
		this._sessionExited = !!exited;
		this._maybeStop();
	}

	private _maybeStop(): void {
		if (this._stopped || !this._sessionExited || !this._connectionLost) {
			return;
		}
		this._stopped = true;
		this._stopReconnecting();
	}
}

export class PwbSessionExitListener extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.pwbSessionExitListener';

	constructor(
		@IRemoteAgentService remoteAgentService: IRemoteAgentService,
		@ILogService logService: ILogService,
	) {
		super();
		const connection = remoteAgentService.getConnection();
		if (!connection) {
			return;
		}
		const watcher = this._register(new PwbSessionExitWatcher(connection.onDidStateChange, () => {
			logService.info('[remote-connection] Posit Workbench reports this session has exited; stopping remote reconnection.');
			// handled=true: rsLoginCheck.js already shows the "Session Exited" overlay.
			PersistentConnection.triggerPermanentFailure(0, 0, true);
		}));
		this._register(dom.addDisposableListener(mainWindow, PWB_SESSION_EXITED_EVENT, (e: CustomEvent<{ exited?: boolean }>) => watcher.setSessionExited(e.detail?.exited)));
		watcher.setSessionExited((mainWindow as unknown as { pwbSessionExited?: boolean }).pwbSessionExited);
	}
}
// --- End PWB ---
