/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export const POSITRON_CANVAS_MODE_CHANNEL_NAME = 'positronCanvasMode';

/**
 * The main process's knowledge of Canvas mode: which window, if any, is
 * presenting Canvas as the whole product.
 *
 * Canvas mode itself is a per-window, renderer-side transaction owned by
 * `PositronCanvasService`, but three main-process decisions need to know it is
 * happening: a new window must not enter Canvas when another window already
 * presents it, the native application menu must not offer IDE surfaces while
 * Canvas is the product, and externally requested opens must not reveal the
 * hidden IDE. The renderer reports engagement here; the main process only
 * ever reads it.
 */
export interface IPositronCanvasModeState {
	/**
	 * Atomically claim Canvas mode for a window. Resolves `true` when the
	 * window now holds the engagement, including when it already held it, so
	 * re-entry in the engaged window stays legitimate. Resolves `false`, and
	 * changes nothing, when another window holds it. A window claims before
	 * its entry transaction's first await; the claim being decided in one
	 * place is what makes one Canvas per application a guarantee rather than
	 * a report.
	 */
	acquire(windowId: number): Promise<boolean>;

	/**
	 * Give up the engagement. Only the holder's release changes anything, so
	 * a stale release from a window that lost a race cannot drop another
	 * window's claim.
	 */
	release(windowId: number): Promise<void>;
}

/**
 * What happens to an externally requested open -- a second-instance
 * `positron <file>`, Finder's Open With, a drop on the Dock icon -- while
 * Canvas mode is engaged. Today such an open reveals the hidden IDE window
 * and blocks on a workspace-trust dialog behind Canvas.
 *
 * `defer` holds the open until Canvas mode releases, keeping Canvas the only
 * visible surface; the open then proceeds into the restored IDE. `exit-and-open`
 * treats the request as a reason to leave Canvas: Canvas exits to the IDE and
 * the open proceeds immediately.
 *
 * The product decision is `exit-and-open`: a user opening a file from Finder
 * or the command line is explicitly asking for the IDE, and a silently held
 * open looks like the open did nothing.
 */
export type CanvasExternalOpenPolicy = 'defer' | 'exit-and-open';
export const CANVAS_EXTERNAL_OPEN_POLICY: CanvasExternalOpenPolicy = 'exit-and-open';

/**
 * How the main process should route an externally requested open.
 *
 * Not engaged means nothing to protect. A waited open (`--wait`) exits
 * Canvas under either policy: the requesting process blocks until its file
 * closes, so deferring would suspend it indefinitely, and proceeding without
 * exiting is the very reveal-behind-Canvas this routing exists to prevent.
 */
export function routeExternalOpen(engaged: boolean, waited: boolean, policy: CanvasExternalOpenPolicy): 'proceed' | 'defer' | 'exit-and-proceed' {
	if (!engaged) {
		return 'proceed';
	}
	if (waited) {
		return 'exit-and-proceed';
	}
	return policy === 'defer' ? 'defer' : 'exit-and-proceed';
}

export const IPositronCanvasModeMainService = createDecorator<IPositronCanvasModeMainService>('positronCanvasModeMainService');

export interface IPositronCanvasModeMainService extends IPositronCanvasModeState {
	readonly _serviceBrand: undefined;

	/** Fires when Canvas mode is engaged or released in any window. */
	readonly onDidChange: Event<void>;

	/** Whether any window is currently presenting Canvas mode. */
	readonly isEngaged: boolean;

	/**
	 * Whether a window other than the given one is presenting Canvas mode.
	 * This is the question a window that wants to enter Canvas asks: entering
	 * again in the same window is a legitimate re-entry, a second window is a
	 * duplicate product surface.
	 */
	isEngagedElsewhere(windowId: number): boolean;

	/**
	 * Route an externally requested open according to
	 * `CANVAS_EXTERNAL_OPEN_POLICY`. When Canvas mode is not engaged, `open`
	 * runs immediately. While it is engaged, `exitCanvas` is asked to leave
	 * Canvas mode in the engaged window and `open` waits for the engagement
	 * to actually release -- an open that ran while exit was still merging
	 * the Canvas editor back could reload the very renderer doing the merge.
	 * A release that never arrives stops blocking the open after
	 * `CANVAS_EXIT_WAIT` so an unresponsive Canvas window cannot swallow the
	 * user's file; see `routeExternalOpen` for the exact decision.
	 *
	 * @param waited whether the requesting process blocks until the opened
	 * files close (`--wait`), which rules out holding the open.
	 */
	handleExternalOpen(waited: boolean, open: () => void, exitCanvas: (engagedWindowId: number) => void): Promise<void>;
}

/**
 * How long an externally requested open waits for the engaged window to
 * finish exiting Canvas mode before proceeding anyway. Generous next to an
 * ordinary exit, which is a focus change and an editor move, but bounded:
 * the fallback trades a possible reveal-behind-Canvas for never losing the
 * user's open to a hung renderer.
 */
export const CANVAS_EXIT_WAIT = 10_000;
