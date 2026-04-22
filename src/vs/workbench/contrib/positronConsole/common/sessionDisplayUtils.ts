/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { basename, extname } from '../../../../base/common/path.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { asCssVariable } from '../../../../platform/theme/common/colorUtils.js';
import { LanguageRuntimeSessionMode, RuntimeState } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { POSITRON_QUARTO_ICON } from '../../../common/theme.js';
import { isQuartoDocument } from '../../positronQuarto/common/positronQuartoConfig.js';

/**
 * Checks if a notebook URI belongs to a Quarto/RMarkdown document by looking
 * up the editor model's language ID. This works for both saved files (where the
 * URI path has .qmd/.rmd) and untitled files (where the model's language ID is
 * set to "quarto" or "rmd" by the Quarto extension).
 */
export function isQuartoSession(notebookUri: URI | undefined, modelService: IModelService): boolean {
	if (!notebookUri) {
		return false;
	}
	const model = modelService.getModel(notebookUri);
	return isQuartoDocument(notebookUri.path, model?.getLanguageId());
}

/**
 * Gets the display label for a session given a notebook URI and session name.
 * This is the canonical way to derive a session's label in UI surfaces.
 *
 * For notebook sessions, returns the filename from the URI. Untitled Quarto
 * URIs lack the .qmd extension, so we fall back to sessionName, which the
 * Quarto kernel manager populates with the filename + extension. For sessions
 * without a notebook URI (console), returns sessionName.
 */
export function getSessionDisplayName(
	notebookUri: URI | undefined,
	sessionName: string,
): string {
	if (!notebookUri) {
		return sessionName;
	}
	const name = basename(notebookUri.path);
	return extname(name) ? name : sessionName;
}

/**
 * The subset of session display info needed to determine the session icon.
 */
interface SessionIconInfo {
	readonly sessionMode: LanguageRuntimeSessionMode;
	readonly notebookUri?: URI;
}

/**
 * Gets the icon for a session based on its mode. Returns the Quarto icon for
 * Quarto notebook sessions, the notebook icon for other notebook sessions,
 * and the console icon for console sessions.
 */
export function getSessionIcon(info: SessionIconInfo, modelService: IModelService): ThemeIcon {
	if (info.sessionMode === LanguageRuntimeSessionMode.Notebook) {
		if (isQuartoSession(info.notebookUri, modelService)) {
			return Codicon.positronQuarto;
		}
		return Codicon.notebook;
	}
	return Codicon.positronNewConsole;
}

/**
 * Gets the icon style for a session. Returns a color style for Quarto
 * sessions and undefined for all other sessions.
 */
export function getSessionIconStyle(info: SessionIconInfo, modelService: IModelService): React.CSSProperties | undefined {
	if (info.sessionMode === LanguageRuntimeSessionMode.Notebook &&
		isQuartoSession(info.notebookUri, modelService)) {
		return { color: asCssVariable(POSITRON_QUARTO_ICON) };
	}
	return undefined;
}

/**
 * The display status of a runtime session, derived from a RuntimeState
 */
export const enum RuntimeStatus {
	Active = 'Active',
	Disconnected = 'Disconnected',
	Idle = 'Idle'
}

/**
 * Maps a RuntimeState to a RuntimeStatus. This simplifies the various runtime states into
 * three main display statuses: active, idle, and disconnected. This mapping is used to
 * determine which status icon to show for a session.
 */
export const runtimeStateToRuntimeStatus: Record<RuntimeState, RuntimeStatus> = {
	[RuntimeState.Uninitialized]: RuntimeStatus.Disconnected,
	[RuntimeState.Initializing]: RuntimeStatus.Active,
	[RuntimeState.Starting]: RuntimeStatus.Active,
	[RuntimeState.Restarting]: RuntimeStatus.Active,
	[RuntimeState.Ready]: RuntimeStatus.Idle,
	[RuntimeState.Idle]: RuntimeStatus.Idle,
	[RuntimeState.Busy]: RuntimeStatus.Active,
	[RuntimeState.Interrupting]: RuntimeStatus.Active,
	[RuntimeState.Exiting]: RuntimeStatus.Active,
	[RuntimeState.Exited]: RuntimeStatus.Disconnected,
	[RuntimeState.Offline]: RuntimeStatus.Disconnected,
};
