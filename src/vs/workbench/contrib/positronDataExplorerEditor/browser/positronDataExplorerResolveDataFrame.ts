/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { raceTimeout } from '../../../../base/common/async.js';
import { IPosition } from '../../../../editor/common/core/position.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { CellUri } from '../../notebook/common/notebookCommon.js';
import { POSITRON_VARIABLES_VIEW_ID } from '../../positronVariables/browser/positronVariables.contribution.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { LanguageRuntimeSessionMode } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { IPositronVariablesService } from '../../../services/positronVariables/common/interfaces/positronVariablesService.js';
import { IPositronVariablesInstance } from '../../../services/positronVariables/common/interfaces/positronVariablesInstance.js';
import { IVariableItem } from '../../../services/positronVariables/common/interfaces/variableItem.js';

/**
 * How long to wait for a freshly-created variables instance to receive its
 * initial variable list from the runtime. Bounded because the runtime is an
 * external process: it may be slow, busy, or unresponsive.
 */
const VARIABLES_LIST_READY_TIMEOUT_MS = 2000;

/**
 * Waits for the given variables instance to have at least one known variable,
 * up to {@link VARIABLES_LIST_READY_TIMEOUT_MS}. A no-op if the instance
 * already has variables cached. Returns whether the wait timed out so callers
 * can distinguish "the variable really isn't there" from "we gave up waiting".
 */
const waitForVariables = async (
	instance: IPositronVariablesInstance,
): Promise<{ timedOut: boolean }> => {
	if (instance.variableItems.length > 0) {
		return { timedOut: false };
	}
	let timedOut = false;
	await raceTimeout(
		Event.toPromise(Event.once(instance.onDidChangeEntries)),
		VARIABLES_LIST_READY_TIMEOUT_MS,
		() => { timedOut = true; },
	);
	return { timedOut };
};

/**
 * The services needed to resolve the data frame at an editor position. Passed
 * explicitly (rather than via a ServicesAccessor) so both command handlers and
 * a code action provider can call {@link resolveDataFrameAtPosition}.
 */
export interface IDataFrameResolutionServices {
	readonly languageService: ILanguageService;
	readonly runtimeSessionService: IRuntimeSessionService;
	readonly variablesService: IPositronVariablesService;
	readonly viewsService: IViewsService;
}

/**
 * Options controlling the side effects and patience of
 * {@link resolveDataFrameAtPosition}.
 */
export interface IDataFrameResolutionOptions {
	/**
	 * Whether to wait up to {@link VARIABLES_LIST_READY_TIMEOUT_MS} for a
	 * freshly-created variables instance to report its first variable list.
	 * Interactive callers (a command the user invoked) should wait; background
	 * callers (a code action provider feeding the lightbulb) should not, so the
	 * computation stays instant.
	 */
	readonly wait: boolean;

	/**
	 * Whether to open the Variables view (without stealing focus) when no
	 * variables instance exists yet for the session. Interactive callers should
	 * do this so a never-shown pane still resolves; background callers must not,
	 * since computing a code action should have no visible side effects.
	 */
	readonly openVariablesViewIfNeeded: boolean;
}

/**
 * The outcome of resolving the identifier at an editor position to a viewable
 * data frame. Discriminated by `kind` so callers can map each case to the
 * appropriate notification (interactive command) or simply check for `'ok'`
 * (code action provider).
 */
export type DataFrameResolution =
	| { readonly kind: 'ok'; readonly sessionId: string; readonly item: IVariableItem }
	| { readonly kind: 'no-symbol' }
	| { readonly kind: 'no-session'; readonly languageName: string }
	| { readonly kind: 'variables-unavailable'; readonly languageName: string }
	| { readonly kind: 'not-found'; readonly symbol: string; readonly languageName: string; readonly timedOut: boolean }
	| { readonly kind: 'not-viewable'; readonly symbol: string };

/**
 * Resolves the identifier at the given editor position to a viewable variable
 * in the runtime session for the position's (embedded) language.
 *
 * This is the shared resolution flow behind both the "View Data Frame at
 * Cursor" command and the "Open in Data Explorer" code action. It does not
 * surface any notifications; callers map the returned {@link DataFrameResolution}
 * to user-facing messages as appropriate.
 *
 * @param model The text model under the cursor.
 * @param position The position to resolve.
 * @param services The services needed for resolution.
 * @param options Side-effect and patience options.
 */
export async function resolveDataFrameAtPosition(
	model: ITextModel,
	position: IPosition,
	services: IDataFrameResolutionServices,
	options: IDataFrameResolutionOptions,
): Promise<DataFrameResolution> {
	const { languageService, runtimeSessionService, variablesService, viewsService } = services;

	const word = model.getWordAtPosition(position);
	if (!word) {
		return { kind: 'no-symbol' };
	}
	const symbol = word.word;

	// Use the embedded language at the cursor position rather than the outer
	// document's language, so this works inside R/Python chunks of
	// language-embedded documents (e.g. Quarto).
	const languageId = model.getLanguageIdAtPosition(position.lineNumber, position.column);
	const languageName = languageService.getLanguageName(languageId) ?? languageId;

	// Notebook cells run in a per-notebook kernel session, which owns any
	// variables defined by running the cells. Scripts use the language's console
	// session instead.
	//
	// For scripts: getConsoleSessionForLanguage returns the foreground session
	// (if it matches the language) or the last one brought to the foreground. A
	// console can be running in the background without ever having been
	// foregrounded -- fall back to scanning activeSessions in that case. Mirrors
	// the lookup in PositronConsoleService.executeCode so "run code" and "view
	// data frame" agree on which session to use.
	const cellInfo = CellUri.parse(model.uri);
	const session = cellInfo
		? runtimeSessionService.getNotebookSessionForNotebookUri(cellInfo.notebook)
		: runtimeSessionService.getConsoleSessionForLanguage(languageId)
		?? runtimeSessionService.activeSessions.find(s =>
			s.runtimeMetadata.languageId === languageId &&
			s.metadata.sessionMode === LanguageRuntimeSessionMode.Console,
		);
	if (!session) {
		return { kind: 'no-session', languageName };
	}

	// Variables instances are created and populated lazily by the Variables
	// pane. If the pane has never been shown, or is currently hidden, no
	// instance will exist for this session. In interactive mode, open the pane
	// (without stealing focus), which triggers instance creation, then retry the
	// lookup.
	const findInstance = (): IPositronVariablesInstance | undefined =>
		variablesService.positronVariablesInstances.find(
			instance => instance.session.sessionId === session.sessionId,
		);
	let variablesInstance = findInstance();
	if (!variablesInstance && options.openVariablesViewIfNeeded) {
		await viewsService.openView(POSITRON_VARIABLES_VIEW_ID, false);
		variablesInstance = findInstance();
	}
	if (!variablesInstance) {
		return { kind: 'variables-unavailable', languageName };
	}

	// The variable list arrives asynchronously from the runtime, so a
	// freshly-created instance may not yet have it.
	const timedOut = options.wait
		? (await waitForVariables(variablesInstance)).timedOut
		: false;

	const item = variablesInstance.variableItems.find(v => v.displayName === symbol);
	if (!item) {
		// If we timed out waiting for the first variable update, the symbol
		// might actually be defined but the runtime hasn't reported it yet (e.g.
		// a long-running chunk that assigns the variable and then keeps
		// running). The caller can tell the user that rather than flatly
		// claiming the variable doesn't exist.
		return { kind: 'not-found', symbol, languageName, timedOut };
	}
	if (!item.hasViewer) {
		return { kind: 'not-viewable', symbol };
	}

	return { kind: 'ok', sessionId: session.sessionId, item };
}
