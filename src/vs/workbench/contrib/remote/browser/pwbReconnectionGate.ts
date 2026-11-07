/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// --- Start PWB: login-aware reconnection backoff (rstudio-pro#13201) ---
import * as dom from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IReconnectionGate, PersistentConnection } from '../../../../platform/remote/common/remoteAgentConnection.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';

/** Window event dispatched by rsLoginCheck.js; must match `rs_publishLoginState`. */
export const PWB_LOGIN_STATE_EVENT = 'pwb-login-state';

/** Login state as last reported by rsLoginCheck.js. Unknown counts as logged in (today's behavior). */
export class PwbReconnectionGate extends Disposable implements IReconnectionGate {
	private _isLoggedIn = true;
	private readonly _onDidLogin = this._register(new Emitter<void>());
	readonly onDidLogin = this._onDidLogin.event;

	get isLoggedIn(): boolean {
		return this._isLoggedIn;
	}

	setLoggedIn(loggedIn: boolean | undefined): void {
		if (typeof loggedIn !== 'boolean' || loggedIn === this._isLoggedIn) {
			return;
		}
		this._isLoggedIn = loggedIn;
		if (loggedIn) {
			this._onDidLogin.fire();
		}
	}
}

export class PwbReconnectionGateContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.pwbReconnectionGate';

	constructor(@ILogService logService: ILogService) {
		super();
		const gate = this._register(new PwbReconnectionGate());
		this._register(dom.addDisposableListener(mainWindow, PWB_LOGIN_STATE_EVENT, (e: CustomEvent<{ loggedIn?: boolean }>) => {
			const wasLoggedIn = gate.isLoggedIn;
			gate.setLoggedIn(e.detail?.loggedIn);
			if (gate.isLoggedIn !== wasLoggedIn) {
				logService.info(gate.isLoggedIn
					? '[remote-connection] Logged back in to Posit Workbench; reconnecting now.'
					: '[remote-connection] Logged out of Posit Workbench; slowing remote reconnection until login.');
			}
		}));
		gate.setLoggedIn((mainWindow as unknown as { pwbLoggedIn?: boolean }).pwbLoggedIn);
		PersistentConnection.pwbSetReconnectionGate(gate);
		this._register(toDisposable(() => PersistentConnection.pwbSetReconnectionGate(undefined)));
	}
}
// --- End PWB ---
