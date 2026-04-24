/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { basename, extname } from '../../../../base/common/path.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { getIconClasses, getIconClassesForLanguageId } from '../../../../editor/common/services/getIconClasses.js';
import { FileKind } from '../../../../platform/files/common/files.js';
import { LanguageRuntimeSessionMode, RuntimeState } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { isQuartoDocument } from '../../positronQuarto/common/positronQuartoConfig.js';

/**
 * Checks if a notebook URI belongs to a Quarto/RMarkdown document by looking
 * up the editor model's language ID. This works for both saved files (where the
 * URI path has .qmd/.rmd) and untitled files (where the model's language ID is
 * set to "quarto" or "rmd" by the Quarto extension).
 */
export function isQuartoSession(
	{ notebookUri, modelService }: { notebookUri: URI | undefined; modelService: IModelService },
): boolean {
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
	{ notebookUri, sessionName }: { notebookUri: URI | undefined; sessionName: string },
): string {
	if (!notebookUri) {
		return sessionName;
	}
	const name = basename(notebookUri.path);
	return extname(name) ? name : sessionName;
}

/**
 * The subset of session info needed to determine the session icon.
 */
interface SessionIconInfo {
	readonly sessionMode: LanguageRuntimeSessionMode;
	readonly notebookUri?: URI;
	readonly languageId: string;
}

/**
 * Resolves the CSS classes used to render a session's icon via the file icon.
 * Notebook sessions (including Quarto) match against the notebook
 * URI so the session picks up the same glyph the Explorer shows for that file.
 * Console sessions match against the runtime language id (python / r / etc).
 */
export function getSessionIconClasses(
	info: SessionIconInfo,
	modelService: IModelService,
	languageService: ILanguageService,
): string[] {
	if (info.sessionMode === LanguageRuntimeSessionMode.Notebook && info.notebookUri) {
		return getIconClasses(modelService, languageService, info.notebookUri, FileKind.FILE);
	}
	return getIconClassesForLanguageId(info.languageId);
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
