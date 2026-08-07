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
 * The character appended to an ellipsized session name.
 */
const ELLIPSIS = '\u2026';

/**
 * Whitespace, punctuation, or a symbol of any kind. Symbols count because the
 * trim only ever runs where the name is cut, so the character it removes is
 * always followed by the ellipsis: a trailing "|" or "+" reads as a connector
 * left dangling rather than as part of the name.
 */
const SEPARATOR = /[\s\p{P}\p{S}]/u;

/**
 * Checks whether a character is one an ellipsized session name shouldn't be left
 * ending on, so that a name reads "Python..." and "Some-word..." rather than
 * "Python ..." and "Some-word-...".
 */
function isSeparator(character: string): boolean {
	return SEPARATOR.test(character);
}

/**
 * The fewest characters of a session name worth showing. An ellipsized name is
 * cut back to its first character; past that only the ellipsis itself would be
 * left, which says nothing at all.
 */
const MINIMUM_FITTED_LENGTH = 1;

/**
 * Fits a session name into the given width by ellipsizing it, so that names
 * collapse gracefully as a tab narrows: "Python 3.12.11 (Pyenv)" becomes
 * "Python 3.12.1...", then "Python 3...", then "Python...", and so on.
 *
 * The ellipsis never follows a space or punctuation: a name cut to "Python " or
 * "Some-word-" has that separator trimmed first. The last thing shown is the
 * first character and the ellipsis, "P..."; once even that would be clipped, an
 * empty string is returned and the tab is left showing just the session icons.
 *
 * @param sessionName The full session name.
 * @param availableWidth The width available to render the name, in pixels.
 * @param measureWidth Measures the rendered width of a candidate name, in pixels.
 * @returns The name, an ellipsized form of it, or an empty string.
 */
export function getFittedSessionName(
	sessionName: string,
	availableWidth: number,
	measureWidth: (text: string) => number,
): string {
	// The full name is always preferred, and is returned verbatim so that names
	// which fit are never ellipsized or trimmed.
	if (measureWidth(sessionName) <= availableWidth) {
		return sessionName;
	}

	let length = sessionName.length - 1;
	while (length >= MINIMUM_FITTED_LENGTH) {
		// Never leave the ellipsis sitting after a separator.
		let end = length;
		while (end > 0 && isSeparator(sessionName.charAt(end - 1))) {
			end--;
		}

		if (end < MINIMUM_FITTED_LENGTH) {
			break;
		}

		const candidate = sessionName.slice(0, end) + ELLIPSIS;
		if (measureWidth(candidate) <= availableWidth) {
			return candidate;
		}

		// Trimming may have shortened the name past the next length to try.
		length = end - 1;
	}

	// Too little of the name would be left to be worth showing.
	return '';
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
