/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { Registry } from '../../../../platform/registry/common/platform.js';

// The `positron.canvas.*` commands and this file's view type are the seam
// between Positron and Posit Assistant. The canonical description of both
// sides is ../README.md, mirrored in the assistant repo's
// `frontend-canvas/README.md`; keep the three in step.

/**
 * Boots the workspace straight into Canvas mode. WINDOW-scoped so a workspace
 * can be a Canvas workspace, which is the point: someone who works this way
 * should never have to pass through the IDE.
 */
export const CANVAS_OPEN_ON_STARTUP_KEY = 'canvas.openOnStartup';

/**
 * Remembers that this workspace was presenting Canvas when it last stopped, so
 * a relaunch comes back into Canvas mode rather than into the IDE. Written by
 * the Canvas service and read by the startup contribution; it records what the
 * user was in, never what they configured, so it is storage rather than a
 * setting.
 */
export const CANVAS_MODE_STORAGE_KEY = 'positron.canvasMode.active';

/**
 * Whether a window should boot straight into Canvas mode, in precedence order:
 * a fresh `--canvas` always wins; an explicitly configured
 * `canvas.openOnStartup` beats the stored intent in both directions, because
 * the setting is what the user configured and the stored key is only what they
 * last did; the stored intent then makes "relaunch into whatever you quit in"
 * true; and a workspace with none of the three boots into the IDE.
 *
 * @param canvasFlag whether the window was launched with `--canvas`.
 * @param configuredOpenOnStartup the explicitly configured value of
 * `canvas.openOnStartup` at any scope, or undefined when the user never set
 * it. Callers must read this via `inspect()`: a plain `getValue` cannot tell
 * an explicit `false` apart from unset, and an explicit `false` must override
 * a stored intent.
 * @param storedIntent whether the workspace was presenting Canvas when it
 * last stopped.
 */
export function shouldStartInCanvasMode(canvasFlag: boolean, configuredOpenOnStartup: boolean | undefined, storedIntent: boolean): boolean {
	if (canvasFlag) {
		return true;
	}
	if (configuredOpenOnStartup !== undefined) {
		return configuredOpenOnStartup;
	}
	return storedIntent;
}

/**
 * How an attempt to enter Canvas mode ended. The outcome is data rather than
 * an exception so every caller -- the startup curtain, the palette action, the
 * forwarded `--canvas` launch, and Posit Assistant over the command seam --
 * sees the same three non-entry cases and can present each one with the right
 * copy, instead of flattening them into `false`-or-throw.
 */
export type CanvasEntryOutcome =
	| { readonly entered: true }
	| {
		readonly entered: false;
		/**
		 * `ai-disabled`: the `ai.enabled` switch is off, so entering would
		 * activate the assistant that switch exists to keep off.
		 * `engaged-elsewhere`: another window already presents Canvas, and one
		 * application gets one Canvas surface.
		 * `no-panel`: Posit Assistant did not produce a Canvas panel.
		 * `no-window`: the panel exists but could not be moved into a window of
		 * its own, or the IDE window could not be put away behind it.
		 * `superseded`: the user asked for the IDE back while this entry was
		 * still opening, so it stopped rather than undo their exit.
		 */
		readonly reason: 'ai-disabled' | 'engaged-elsewhere' | 'no-panel' | 'no-window' | 'superseded';
		/** Localized, user-presentable description of the reason. */
		readonly message: string;
	};

/**
 * Set while Canvas is the only surface the user can see. Gates the action that
 * hands the user back to the IDE, which is meaningless outside Canvas mode.
 */
export const PositronCanvasModeActiveContext = new RawContextKey<boolean>('positronCanvasModeActive', false, localize('positron.canvas.modeActiveContext', "Whether Canvas is currently the only visible Positron surface."));

/**
 * Webview panel view type of a Canvas panel. Posit Assistant contributes it;
 * core needs it to tell a Canvas editor apart from any other editor, including
 * the assistant's own chat panels, synchronously and without activating the
 * extension. It is the whole of Canvas-panel identity: comparing a
 * `WebviewInput.providerId` against it is the declared way to recognize a
 * Canvas, and identity never comes from a panel's title, which is localized
 * and user-visible.
 */
export const CANVAS_WEBVIEW_VIEW_TYPE = 'posit-assistant.canvas';

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'canvas',
	order: 6,
	title: localize('positron.canvas.title', "Canvas"),
	type: 'object',
	properties: {
		[CANVAS_OPEN_ON_STARTUP_KEY]: {
			type: 'boolean',
			default: false,
			description: localize('positron.canvas.openOnStartup', "Open Canvas as the only window when this workspace starts, instead of the full Positron interface. Requires Positron's AI features to be enabled."),
			scope: ConfigurationScope.WINDOW
		}
	}
});
