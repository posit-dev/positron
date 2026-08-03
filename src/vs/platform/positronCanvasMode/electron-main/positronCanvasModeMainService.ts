/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { app, BrowserWindow } from 'electron';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { ILogService } from '../../log/common/log.js';
import { CANVAS_EXIT_WAIT, CANVAS_EXTERNAL_OPEN_POLICY, IPositronCanvasModeMainService, routeExternalOpen } from '../common/positronCanvasMode.js';

export class PositronCanvasModeMainService extends Disposable implements IPositronCanvasModeMainService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	/** The window presenting Canvas mode, when there is one. */
	private engagedWindowId: number | undefined = undefined;

	/** Externally requested opens held until Canvas mode releases. */
	private readonly pendingExternalOpens: (() => void)[] = [];

	constructor(
		@ILogService private readonly logService: ILogService
	) {
		super();

		// The renderer releases its claim, but a window that goes away without
		// doing so must not leave Canvas mode engaged forever: a stale
		// engagement would keep suppressing Canvas startup in new windows and
		// keep the application menu trimmed. Closing is one way a window goes
		// away; reloading and a dead renderer process are the others, and both
		// keep the BrowserWindow while discarding the renderer that held the
		// claim. A reloaded window that still wants Canvas re-enters through
		// its restored intent and claims again. Watched per window from
		// creation because the bundled electron typings expose no
		// application-level closed event.
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

	async acquire(windowId: number): Promise<boolean> {
		if (this.engagedWindowId !== undefined && this.engagedWindowId !== windowId) {
			this.logService.info(`[canvas] Window ${windowId} asked to present Canvas while window ${this.engagedWindowId} already does`);
			return false;
		}
		if (this.engagedWindowId !== windowId) {
			this.engagedWindowId = windowId;
			this.logService.trace(`[canvas] Canvas mode engaged in window ${windowId}`);
			this._onDidChange.fire();
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
		this.engagedWindowId = undefined;
		this.logService.trace('[canvas] Canvas mode released');
		this._onDidChange.fire();
		this.flushPendingExternalOpens();
	}

	async handleExternalOpen(waited: boolean, open: () => void, exitCanvas: (engagedWindowId: number) => void): Promise<void> {
		const engagedWindowId = this.engagedWindowId;
		switch (routeExternalOpen(engagedWindowId !== undefined, waited, CANVAS_EXTERNAL_OPEN_POLICY)) {
			case 'proceed':
				open();
				break;
			case 'defer':
				this.logService.info('[canvas] Holding an externally requested open until Canvas mode releases');
				this.pendingExternalOpens.push(open);
				break;
			case 'exit-and-proceed': {
				this.logService.info('[canvas] Leaving Canvas mode for an externally requested open');
				exitCanvas(engagedWindowId!);

				// The open must not land while exit is still merging the Canvas
				// editor back into the IDE: opening into a reused window can
				// reload the very renderer doing the merge. Wait for the claim
				// to actually drop, but never indefinitely -- a hung renderer
				// must not swallow the user's file.
				if (!await this.waitForRelease(CANVAS_EXIT_WAIT)) {
					this.logService.warn(`[canvas] Canvas mode did not release within ${CANVAS_EXIT_WAIT}ms; opening anyway`);
				}
				open();
				break;
			}
		}
	}

	/**
	 * Resolves `true` once no window holds the claim, `false` if that has not
	 * happened after `timeoutMs`. Hand-rolled rather than event combinators so
	 * the listener is dropped on the timeout path too -- external opens can
	 * repeat, and a listener per timed-out open would accumulate for the life
	 * of the process.
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

	private flushPendingExternalOpens(): void {
		if (this.pendingExternalOpens.length === 0) {
			return;
		}
		this.logService.info(`[canvas] Running ${this.pendingExternalOpens.length} open request(s) held while Canvas mode was engaged`);
		for (const open of this.pendingExternalOpens.splice(0)) {
			try {
				open();
			} catch (error) {
				this.logService.error('[canvas] A held open request failed', error);
			}
		}
	}
}
