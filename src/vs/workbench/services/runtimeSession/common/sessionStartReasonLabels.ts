/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILocalizedString, localize2 } from '../../../../nls.js';
import { IRuntimeSessionMetadata, IRuntimeSessionStartReason, SessionStartReason } from './runtimeSessionService.js';

/**
 * User-facing labels for each session start reason.
 */
const sessionStartReasonLabels: Record<SessionStartReason, ILocalizedString> = {
	[SessionStartReason.AffiliatedRuntime]: localize2('positron.sessionStartReason.affiliatedRuntime', "This workspace's last used interpreter was restored at startup"),
	[SessionStartReason.AffiliatedRuntimeRegistered]: localize2('positron.sessionStartReason.affiliatedRuntimeRegistered', "The interpreter scan found this workspace's last used interpreter"),
	[SessionStartReason.ExtensionRequestedImmediateStart]: localize2('positron.sessionStartReason.extensionRequestedImmediateStart', "This interpreter's extension requested an immediate start, and no interpreter was saved for this workspace"),
	[SessionStartReason.ExtensionRequestedStartAfterRegistration]: localize2('positron.sessionStartReason.extensionRequestedStartAfterRegistration', "This interpreter's extension requested an immediate start after startup finished"),
	[SessionStartReason.ExtensionRecommendedRuntime]: localize2('positron.sessionStartReason.extensionRecommendedRuntime', "An extension recommended this interpreter for this workspace"),
	[SessionStartReason.StartupBehaviorAlways]: localize2('positron.sessionStartReason.startupBehaviorAlways', "Startup Behavior is set to always for this language"),
	[SessionStartReason.LanguageFileOpenAtRegistration]: localize2('positron.sessionStartReason.languageFileOpenAtRegistration', "This interpreter was found after a file in this language was opened"),
	[SessionStartReason.LanguageFileOpened]: localize2('positron.sessionStartReason.languageFileOpened', "A file in this language was opened"),
	[SessionStartReason.UserSelectedRuntime]: localize2('positron.sessionStartReason.userSelectedRuntime', "You selected this interpreter"),
	[SessionStartReason.NewConsoleCommand]: localize2('positron.sessionStartReason.newConsoleCommand', "A command requested a new console for this interpreter"),
	[SessionStartReason.DuplicatedConsoleSession]: localize2('positron.sessionStartReason.duplicatedConsoleSession', "A console was duplicated"),
	[SessionStartReason.DuplicatedNotebookSession]: localize2('positron.sessionStartReason.duplicatedNotebookSession', "A notebook session was duplicated into a console"),
	[SessionStartReason.CodeExecutedWithoutSession]: localize2('positron.sessionStartReason.codeExecutedWithoutSession', "Code was sent to the console with no session for this language"),
	[SessionStartReason.RestartUninitializedSession]: localize2('positron.sessionStartReason.restartUninitializedSession', "A restart was requested for a session that never started"),
	[SessionStartReason.NewFolderNotebook]: localize2('positron.sessionStartReason.newFolderNotebook', "A new folder was created with a starter notebook"),
	[SessionStartReason.QuartoInlineOutput]: localize2('positron.sessionStartReason.quartoInlineOutput', "Code was run in a Quarto document with inline output"),
	[SessionStartReason.NotebookCellsExecuted]: localize2('positron.sessionStartReason.notebookCellsExecuted', "Notebook cells were run with no kernel running"),
	[SessionStartReason.NotebookCodeFragmentExecuted]: localize2('positron.sessionStartReason.notebookCodeFragmentExecuted', "Selected code in a notebook cell was run with no kernel"),
	[SessionStartReason.NotebookKernelSelected]: localize2('positron.sessionStartReason.notebookKernelSelected', "A kernel was selected for this notebook"),
	[SessionStartReason.NotebookKernelSelectionDeferred]: localize2('positron.sessionStartReason.notebookKernelSelectionDeferred', "A kernel selected before its interpreter was found became available"),
	[SessionStartReason.NotebookEditorOpened]: localize2('positron.sessionStartReason.notebookEditorOpened', "This notebook was opened"),
	[SessionStartReason.NotebookEditorActivated]: localize2('positron.sessionStartReason.notebookEditorActivated', "This notebook's background or preview tab became active"),
	[SessionStartReason.NotebookKernelRestart]: localize2('positron.sessionStartReason.notebookKernelRestart', "Restart Kernel was used with no kernel running"),
	[SessionStartReason.ExtensionApi]: localize2('positron.sessionStartReason.extensionApi', "An extension asked for this session through the Positron API"),
};

/**
 * Gets the user-facing label for why a session was started. Falls back to the
 * non-localized description for sessions without a known start reason ID,
 * such as sessions persisted before the ID existed.
 *
 * @param metadata The session's metadata.
 * @returns The label, or an empty string if the session has no start reason.
 */
export function getSessionStartReasonLabel(metadata: Pick<IRuntimeSessionMetadata, 'startReason' | 'startReasonId'>): string {
	const label = metadata.startReasonId && sessionStartReasonLabels[metadata.startReasonId]?.value;
	return label || metadata.startReason;
}

/**
 * Creates the start reason for a request to start a runtime session. The
 * detail is the English label, followed by any values that identify the
 * request.
 *
 * @param id Why the session is being started.
 * @param values Values that identify the request, such as the language ID.
 * @returns The start reason.
 */
export function createSessionStartReason(id: SessionStartReason, values?: Record<string, string>): IRuntimeSessionStartReason {
	const label = sessionStartReasonLabels[id].original;
	const entries = Object.entries(values ?? {});
	const detail = entries.length ?
		`${label} (${entries.map(([key, value]) => `${key}: ${value}`).join(', ')})` :
		label;
	return { id, detail };
}
