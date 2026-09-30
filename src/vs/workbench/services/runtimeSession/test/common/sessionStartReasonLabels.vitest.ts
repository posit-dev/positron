/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { SessionStartReason } from '../../common/runtimeSessionService.js';
import { createSessionStartReason, getSessionStartReasonLabel } from '../../common/sessionStartReasonLabels.js';

describe('getSessionStartReasonLabel', () => {
	// The IDs are persisted with session metadata, so a renamed ID or a
	// changed label shows up as a diff here.
	it('labels every start reason', () => {
		const labels = Object.fromEntries(Object.values(SessionStartReason).map(id =>
			[id, getSessionStartReasonLabel({ startReason: 'detail', startReasonId: id })]
		));

		expect(labels).toMatchInlineSnapshot(`
			{
			  "affiliatedRuntime": "This workspace's last used interpreter was restored at startup",
			  "affiliatedRuntimeRegistered": "The interpreter scan found this workspace's last used interpreter",
			  "codeExecutedWithoutSession": "Code was sent to the console with no session for this language",
			  "duplicatedConsoleSession": "A console was duplicated",
			  "duplicatedNotebookSession": "A notebook session was duplicated into a console",
			  "extensionApi": "An extension asked for this session through the Positron API",
			  "extensionRecommendedRuntime": "An extension recommended this interpreter for this workspace",
			  "extensionRequestedImmediateStart": "This interpreter's extension requested an immediate start, and no interpreter was saved for this workspace",
			  "extensionRequestedStartAfterRegistration": "This interpreter was found after startup, and its extension asked to start it right away",
			  "languageFileOpenAtRegistration": "This interpreter was found after a file in this language was opened",
			  "languageFileOpened": "A file in this language was opened",
			  "newConsoleCommand": "A command requested a new console for this interpreter",
			  "newFolderNotebook": "This notebook was created with a new folder from the Jupyter Notebook template",
			  "notebookCellsExecuted": "Notebook cells were run with no kernel running",
			  "notebookCodeFragmentExecuted": "Selected code in a notebook cell was run with no kernel",
			  "notebookEditorActivated": "This notebook's preview tab was kept open, or its background tab was brought to the front",
			  "notebookEditorOpened": "This notebook was opened",
			  "notebookKernelRestart": "Restart Kernel was used with no kernel running",
			  "notebookKernelSelected": "A kernel was selected for this notebook",
			  "notebookKernelSelectionDeferred": "This notebook's kernel started once its interpreter was found",
			  "quartoInlineOutput": "Code was run in a Quarto document with inline output",
			  "restartUninitializedSession": "A restart was requested for a session that never started",
			  "startupBehaviorAlways": "Startup Behavior is set to always for this language",
			  "userSelectedRuntime": "You selected this interpreter",
			}
		`);
	});

	it('falls back to the description when the session has no start reason ID', () => {
		expect(getSessionStartReasonLabel({ startReason: 'Affiliated Python runtime for workspace' }))
			.toBe('Affiliated Python runtime for workspace');
	});

	it('falls back to the description when the start reason ID is unknown', () => {
		// A session persisted by a newer version can carry an ID this version doesn't know.
		expect(getSessionStartReasonLabel({ startReason: 'Started by a future feature', startReasonId: 'futureReason' as SessionStartReason }))
			.toBe('Started by a future feature');
	});
});

describe('createSessionStartReason', () => {
	it('uses the English label as the detail', () => {
		expect(createSessionStartReason(SessionStartReason.UserSelectedRuntime))
			.toEqual({ id: SessionStartReason.UserSelectedRuntime, detail: 'You selected this interpreter' });
	});

	it('appends the values that identify the request to the detail', () => {
		expect(createSessionStartReason(SessionStartReason.CodeExecutedWithoutSession, { language: 'python', 'code source': 'assistant' }).detail)
			.toBe('Code was sent to the console with no session for this language (language: python, code source: assistant)');
	});
});
