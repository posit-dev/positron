/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { ExtensionIdentifier, IExtensionDescription } from '../../../../../platform/extensions/common/extensions.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ILanguageRuntimeMetadata } from '../../../languageRuntime/common/languageRuntimeService.js';
import { IRuntimeSessionMetadata, SessionStartReasonId } from '../../common/runtimeSessionService.js';
import { createSessionStartReason, getSessionStartReasonLabel } from '../../common/sessionStartReasons.js';

describe('getSessionStartReasonLabel', () => {
	const extensions = [stubInterface<IExtensionDescription>({
		identifier: new ExtensionIdentifier('positron.positron-r'),
		displayName: 'Positron R',
	})];

	function createSession(startReason: string, startReasonId?: SessionStartReasonId, extensionId = 'positron.positron-r') {
		return {
			runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({
				languageName: 'R',
				runtimeName: 'R 4.4.1',
				extensionId: new ExtensionIdentifier(extensionId),
			}),
			metadata: stubInterface<IRuntimeSessionMetadata>({
				startReason,
				startReasonId,
				notebookUri: URI.file('/work/analysis.ipynb'),
			}),
		};
	}

	// The IDs are persisted with session metadata, so a renamed ID or a
	// changed label shows up as a diff here.
	it('labels every start reason', () => {
		const labels = Object.fromEntries(Object.values(SessionStartReasonId).map(id =>
			[id, getSessionStartReasonLabel(createSession('detail', id), extensions)]
		));

		expect(labels).toMatchInlineSnapshot(`
			{
			  "affiliatedRuntime": "This workspace's last used interpreter was started when Positron started",
			  "affiliatedRuntimeAtRegistration": "This workspace's last used interpreter was started when found by interpreter discovery",
			  "codeExecutedWithoutSession": "Code was sent to the console with no R session",
			  "duplicatedConsoleSession": "A console was duplicated",
			  "duplicatedNotebookSession": "A notebook session was duplicated into a console",
			  "extensionApi": "An extension asked for this session through the Positron API",
			  "extensionRecommendedRuntime": "The Positron R extension recommended starting the interpreter for this workspace",
			  "extensionRequestedImmediateStart": "The Positron R extension recommended R 4.4.1 for this workspace when interpreter discovery finished",
			  "extensionRequestedStartAtRegistration": "A new interpreter was found after startup, and the Positron R extension recommended R 4.4.1 for this workspace",
			  "languageFileOpened": "This interpreter was started after a file written in R was opened",
			  "languageFileOpenedAtRegistration": "This interpreter was started after a file written in R was opened",
			  "newConsoleCommand": "A command requested a new console for this interpreter",
			  "newFolderNotebook": "This notebook was created with a new folder from the Jupyter Notebook template",
			  "notebookCellsExecuted": "Notebook cells were run with no kernel running",
			  "notebookCodeFragmentExecuted": "Selected code in a notebook cell was run with no kernel",
			  "notebookEditorActivated": "This notebook's preview tab was kept open, or its background tab was brought to the front",
			  "notebookEditorOpened": "The analysis.ipynb notebook was opened",
			  "notebookKernelRestart": "Restart Kernel was used with no kernel running",
			  "notebookKernelSelected": "A kernel was selected for this notebook",
			  "notebookKernelSelectionDeferred": "This notebook's kernel started once its interpreter was found",
			  "quartoInlineOutput": "A Quarto document with inline output needed a kernel",
			  "restartUninitializedSession": "A restart was requested for a session that never started",
			  "startupBehaviorAlways": "Startup Behavior is set to "Always" for R",
			  "userSelectedRuntime": "You selected this interpreter",
			}
		`);
	});

	it('uses the extension ID when the extension is not registered', () => {
		expect(getSessionStartReasonLabel(createSession('detail', SessionStartReasonId.ExtensionRecommendedRuntime, 'example.missing'), extensions))
			.toBe('The example.missing extension recommended starting the interpreter for this workspace');
	});

	it('falls back to the description when the session has no start reason ID', () => {
		expect(getSessionStartReasonLabel(createSession('Affiliated Python runtime for workspace'), extensions))
			.toBe('Affiliated Python runtime for workspace');
	});

	it('falls back to the description when the start reason ID is unknown', () => {
		// A session persisted by a newer version can carry an ID this version doesn't know.
		expect(getSessionStartReasonLabel(createSession('Started by a future feature', 'futureReason' as SessionStartReasonId), extensions))
			.toBe('Started by a future feature');
	});
});

describe('createSessionStartReason', () => {
	it('uses the English label as the detail', () => {
		expect(createSessionStartReason(SessionStartReasonId.UserSelectedRuntime))
			.toEqual({ id: SessionStartReasonId.UserSelectedRuntime, detail: 'You selected this interpreter' });
	});

	it('appends the values that identify the request to the detail', () => {
		expect(createSessionStartReason(SessionStartReasonId.CodeExecutedWithoutSession, { language: 'python', 'code source': 'assistant' }).detail)
			.toBe('Code was sent to the console with no python session (language: python, code source: assistant)');
	});
});
