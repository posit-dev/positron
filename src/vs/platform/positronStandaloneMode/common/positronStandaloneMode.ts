/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export const POSITRON_STANDALONE_MODE_CHANNEL_NAME = 'positronStandaloneMode';

/**
 * The main process's record of standalone mode: which window, if any, is
 * presenting a single view as the whole product surface. The renderer that
 * enters the mode reports engagement here; the main process reads it to keep
 * the mode single-instance, trim the native menus, and route external opens.
 */
export interface IPositronStandaloneModeState {
	/**
	 * Atomically claim the mode for a window. Resolves `true` when the window
	 * now holds the engagement (including when it already held it), `false`
	 * and changes nothing when another window holds it.
	 *
	 * @param exitCommandId the workbench command that leaves the mode in the
	 * engaging window; declared at acquire time so the main process can ask
	 * the mode to stand down without knowing which feature engaged it.
	 */
	acquire(windowId: number, exitCommandId: string): Promise<boolean>;

	/** Give up the engagement. Only the holder's release changes anything. */
	release(windowId: number): Promise<void>;
}

export const IPositronStandaloneModeMainService = createDecorator<IPositronStandaloneModeMainService>('positronStandaloneModeMainService');

export interface IPositronStandaloneModeMainService extends IPositronStandaloneModeState {
	readonly _serviceBrand: undefined;

	/** Fires when the mode is engaged or released in any window. */
	readonly onDidChange: Event<void>;

	/** Whether any window currently presents the mode. */
	readonly isEngaged: boolean;

	/**
	 * Whether a window other than the given one presents the mode: re-entry
	 * in the engaged window is legitimate, a second window is a duplicate
	 * product surface.
	 */
	isEngagedElsewhere(windowId: number): boolean;

	/**
	 * Route an externally requested open. While engaged, `exitMode` is asked
	 * to run the engagement's declared exit command in the engaged window,
	 * and `open` waits for the release, bounded by `EXTERNAL_OPEN_EXIT_WAIT`.
	 */
	handleExternalOpen(open: () => void, exitMode: (engagedWindowId: number, exitCommandId: string) => void): Promise<void>;
}

/**
 * How long an external open waits for the engaged window to release before
 * proceeding anyway: generous next to an ordinary exit, but bounded so a hung
 * renderer cannot swallow the open.
 */
export const EXTERNAL_OPEN_EXIT_WAIT = 10_000;
