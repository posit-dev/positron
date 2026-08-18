/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { Registry } from '../../../../platform/registry/common/platform.js';

// The `positron.canvas.*` commands and `CANVAS_WEBVIEW_VIEW_TYPE` are the seam
// between Positron and Posit Assistant; ../README.md is the canonical
// description, mirrored in the assistant repo's `frontend-canvas/README.md`.

export { CANVAS_WEBVIEW_VIEW_TYPE } from '../../../common/positronCanvasIdentity.js';

/**
 * Boots the workspace straight into Canvas mode. WINDOW-scoped so a workspace
 * can be a Canvas workspace.
 */
export const CANVAS_OPEN_ON_STARTUP_KEY = 'canvas.openOnStartup';

/**
 * Remembers that this workspace was presenting Canvas when it last stopped, so
 * a relaunch comes back into Canvas mode. Records what the user was in, never
 * what they configured, so it is storage rather than a setting.
 */
export const CANVAS_MODE_STORAGE_KEY = 'positron.canvasMode.active';

/** Everything the boot-into-Canvas decision reads. */
export interface ICanvasStartSignals {
	/** The `ai.enabled` main switch, read live. */
	readonly aiEnabled: boolean;
	/** Whether another window held standalone mode when this window opened. */
	readonly engagedElsewhere: boolean;
	/** Whether the window was opened with `--canvas`. */
	readonly canvasFlag: boolean;
	/**
	 * Explicitly configured `canvas.openOnStartup`. Must come from
	 * `inspect()`, not `getValue`: an explicit `false` must override a stored
	 * intent, and `getValue` cannot tell explicit `false` apart from unset.
	 */
	readonly configuredOpenOnStartup: boolean | undefined;
	/** Whether the workspace was in Canvas mode when it last stopped. */
	readonly storedIntent: boolean;
}

/**
 * Whether a window should boot straight into Canvas mode. Two window-level
 * vetoes beat every entry signal: `ai.enabled` off, and the mode engaged in
 * another window. Then precedence: a fresh `--canvas` always wins; an
 * explicitly configured `canvas.openOnStartup` beats the stored intent in
 * both directions; the stored intent then makes "relaunch into whatever you
 * quit in" true.
 */
export function shouldStartInCanvasMode(signals: ICanvasStartSignals): boolean {
	if (!signals.aiEnabled || signals.engagedElsewhere) {
		return false;
	}
	if (signals.canvasFlag) {
		return true;
	}
	if (signals.configuredOpenOnStartup !== undefined) {
		return signals.configuredOpenOnStartup;
	}
	return signals.storedIntent;
}

/**
 * How an attempt to enter Canvas mode ended. Data rather than an exception so
 * every caller (curtain, palette action, forwarded launch, the assistant over
 * the command seam) can present each non-entry case with the right copy.
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
 * as standalone mode's exit command at engagement time.
 */
export const CANVAS_EXIT_COMMAND_ID = 'positron.canvas.exit';

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'canvas',
	title: localize('positron.canvas.title', "Canvas"),
	type: 'object',
	properties: {
		[CANVAS_OPEN_ON_STARTUP_KEY]: {
			type: 'boolean',
			default: false,
			description: localize('positron.canvas.openOnStartup', "Experimental. Open Canvas as the only window when this workspace starts, instead of the full Positron interface. Requires a Canvas-capable Posit Assistant."),
			included: false,
			tags: ['experimental'],
			scope: ConfigurationScope.WINDOW
		}
	}
});
