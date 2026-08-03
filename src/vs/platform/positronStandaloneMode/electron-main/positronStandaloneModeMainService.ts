/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { app, BrowserWindow } from 'electron';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { ILogService } from '../../log/common/log.js';
import { EXTERNAL_OPEN_EXIT_WAIT, IPositronStandaloneModeMainService } from '../common/positronStandaloneMode.js';

export class PositronStandaloneModeMainService extends Disposable implements IPositronStandaloneModeMainService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	/**
	 * The window presenting standalone mode and the command that exits the
	 * mode there, when there is one.
	 */
	private engagement: { windowId: number; exitCommandId: string } | undefined = undefined;

	private get engagedWindowId(): number | undefined {
		return this.engagement?.windowId;
	}

	constructor(
		@ILogService private readonly logService: ILogService
	) {
		super();

		// A window that goes away without releasing its claim must not leave
		// the mode engaged forever. Reload and a dead renderer keep the
		// BrowserWindow while discarding the renderer that held the claim, so
		// all three paths release; a reloaded window re-enters through its
		// restored intent. Watched per window because the bundled electron
		// typings expose no application-level closed event.
		const onWindowCreated = (_event: Electron.Event, window: BrowserWindow) => {
			const windowId = window.id;
			const releaseIfHeld = () => {
				if (windowId === this.engagedWindowId) {
					this.doRelease(windowId);
				}
			};
			window.on('closed', releaseIfHeld);
			window.webContents.on('did-navigate', releaseIfHeld);
			window.webContents.on('render-process-gone', releaseIfHeld);
		};
		app.on('browser-window-created', onWindowCreated);
		this._register({ dispose: () => app.removeListener('browser-window-created', onWindowCreated) });
	}

	get isEngaged(): boolean {
		return this.engagedWindowId !== undefined;
	}

	isEngagedElsewhere(windowId: number): boolean {
		return this.engagedWindowId !== undefined && this.engagedWindowId !== windowId;
	}

	async acquire(windowId: number, exitCommandId: string): Promise<boolean> {
		if (this.engagedWindowId !== undefined && this.engagedWindowId !== windowId) {
			this.logService.info(`[standalone mode] Window ${windowId} asked to engage while window ${this.engagedWindowId} holds the mode`);
			return false;
		}
		if (this.engagedWindowId !== windowId) {
			this.engagement = { windowId, exitCommandId };
			this.logService.trace(`[standalone mode] Engaged in window ${windowId}`);
			this._onDidChange.fire();
		} else if (this.engagement?.exitCommandId !== exitCommandId) {
			// A successful reacquire redeclares the command used by future opens.
			this.engagement = { windowId, exitCommandId };
		}
		return true;
	}

	async release(windowId: number): Promise<void> {
		this.doRelease(windowId);
	}

	private doRelease(windowId: number): void {
		if (this.engagedWindowId !== windowId) {
			return;
		}
		this.engagement = undefined;
		this.logService.trace('[standalone mode] Released');
		this._onDidChange.fire();
	}

	async handleExternalOpen(open: () => void, exitMode: (engagedWindowId: number, exitCommandId: string) => void): Promise<void> {
		const engagement = this.engagement;
		if (!engagement) {
			open();
			return;
		}

		this.logService.info('[standalone mode] Leaving the mode for an externally requested open');
		exitMode(engagement.windowId, engagement.exitCommandId);

		// Opening into a reused window can reload the very renderer still
		// running the exit, so wait for the claim to drop, but never indefinitely.
		if (!await this.waitForRelease(EXTERNAL_OPEN_EXIT_WAIT)) {
			this.logService.warn(`[standalone mode] Not released within ${EXTERNAL_OPEN_EXIT_WAIT}ms; opening anyway`);
		}
		open();
	}

	/**
	 * Resolves `true` once no window holds the claim, `false` after
	 * `timeoutMs`. Hand-rolled so the listener is dropped on the timeout path
	 * too; a listener per timed-out open would accumulate.
	 */
	private waitForRelease(timeoutMs: number): Promise<boolean> {
		if (!this.isEngaged) {
			return Promise.resolve(true);
		}
		return new Promise<boolean>(resolve => {
			const listener = this.onDidChange(() => {
				if (!this.isEngaged) {
					clearTimeout(timer);
					listener.dispose();
					resolve(true);
				}
			});
			const timer = setTimeout(() => {
				listener.dispose();
				resolve(false);
			}, timeoutMs);
		});
	}

}
