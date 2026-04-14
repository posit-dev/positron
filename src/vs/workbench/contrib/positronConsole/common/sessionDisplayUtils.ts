/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { basename } from '../../../../base/common/path.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { asCssVariable } from '../../../../platform/theme/common/colorUtils.js';
import { LanguageRuntimeSessionMode, RuntimeState } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeSessionDisplayInfo } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { RuntimeStatus } from '../browser/components/runtimeStatus.js';
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
 * Gets the display name for a notebook file. For untitled Quarto documents,
 * the .qmd extension is appended since the URI doesn't include it.
 */
export function getNotebookDisplayName(notebookUri: URI, modelService: IModelService): string {
	let name = basename(notebookUri.path);
	if (!name.includes('.') && isQuartoSession(notebookUri, modelService)) {
		name = `${name}.qmd`;
	}
	return name;
}

/**
 * Gets the display label for a session. For notebook sessions, this includes
 * the notebook file name and the runtime name. For Quarto sessions, the
 * runtime name is used instead of the session name (which redundantly
 * contains the file name). For untitled Quarto documents, the .qmd extension
 * is appended since the URI doesn't include it.
 */
export function getSessionDisplayName(info: IRuntimeSessionDisplayInfo, modelService: IModelService): string {
	if (info.sessionMode === LanguageRuntimeSessionMode.Notebook && info.notebookUri) {
		const notebookName = getNotebookDisplayName(info.notebookUri, modelService);
		// For Quarto sessions, show the underlying runtime name (e.g.
		// "Python 3.12.11 (Pyenv)") instead of the session name (which is
		// "Quarto: <file>.qmd" and would duplicate the file name).
		const env = isQuartoSession(info.notebookUri, modelService)
			? info.runtimeName
			: info.sessionName;
		return `${notebookName} - ${env}`;
	}
	return info.sessionName;
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
 * Maps a RuntimeState to a RuntimeStatus for display purposes.
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
