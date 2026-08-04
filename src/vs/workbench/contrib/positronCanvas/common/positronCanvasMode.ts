/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';

// The `positron.canvas.*` commands and `CANVAS_WEBVIEW_VIEW_TYPE` are the seam
// between Positron and Posit Assistant; ../README.md is the canonical
// description, mirrored in the assistant repo's `frontend-canvas/README.md`.

export { CANVAS_WEBVIEW_VIEW_TYPE } from '../../../common/positronCanvasIdentity.js';

/**
 * How an attempt to enter Canvas mode ended. Data rather than an exception so
 * every caller (palette action, the assistant over the command seam) can
 * present each non-entry case with the right copy.
 */
export type CanvasEntryOutcome =
	| { readonly entered: true }
	| {
		readonly entered: false;
		/**
		 * `ai-disabled`: the `ai.enabled` switch is off.
		 * `engaged-elsewhere`: another window already presents Canvas.
		 * `no-panel`: Posit Assistant did not produce a Canvas panel.
		 * `no-window`: the panel could not get a window of its own, or the
		 * IDE window could not be put away behind it.
		 * `superseded`: the user asked for the IDE back mid-entry.
		 */
		readonly reason: 'ai-disabled' | 'engaged-elsewhere' | 'no-panel' | 'no-window' | 'superseded';
		/** Localized, user-presentable description of the reason. */
		readonly message: string;
	};

/**
 * Set while Canvas is the only surface the user can see. Gates the action
 * that hands the user back to the IDE.
 */
export const PositronCanvasModeActiveContext = new RawContextKey<boolean>('positronCanvasModeActive', false, localize('positron.canvas.modeActiveContext', "Whether Canvas is currently the only visible Positron surface."));

/**
 * Command id of the action that exits Canvas mode; part of the pinned
 * `positron.canvas.*` seam (../README.md). Also declared to the main process
 * as standalone mode's exit command at engagement time, so an externally
 * requested open can ask Canvas to stand down without the main process
 * knowing about Canvas.
 */
export const CANVAS_EXIT_COMMAND_ID = 'positron.canvas.exit';
