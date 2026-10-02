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
import { describeSessionStartReason, getSessionStartReasonLabel } from '../../common/sessionStartReasons.js';

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
			  "duplicatedNotebookSession": "A console was started from the R 4.4.1 notebook session",
			  "extensionApiSelect": "You started this interpreter",
			  "extensionApiStart": "An extension asked for this session through the Positron API",
			  "extensionRecommendedRuntime": "The Positron R extension recommended starting R 4.4.1 for this workspace",
			  "extensionRequestedImmediateStart": "The Positron R extension recommended R 4.4.1 for this workspace when interpreter discovery finished",
			  "extensionRequestedStartAtRegistration": "A new interpreter was found after startup, and the Positron R extension recommended R 4.4.1 for this workspace",
			  "languageFileOpened": "This interpreter was started after a file written in R was opened",
			  "languageFileOpenedAtRegistration": "This interpreter was started after a file written in R was opened",
			  "newConsoleCommand": "A command requested a new console for this interpreter",
			  "newFolderNotebook": "This notebook was created with a new folder from the Jupyter Notebook template",
			  "notebookCellsExecuted": "Cells in analysis.ipynb were run with no kernel running",
			  "notebookCodeFragmentExecuted": "Selected code in analysis.ipynb was run with no kernel",
			  "notebookEditorActivated": "analysis.ipynb's preview tab was kept open, or its background tab was brought to the front",
			  "notebookEditorOpened": "The analysis.ipynb notebook was opened",
			  "notebookKernelRestart": "Restart Kernel was used in analysis.ipynb with no kernel running",
			  "notebookKernelSelected": "The R 4.4.1 kernel was selected for analysis.ipynb",
			  "notebookKernelSelectionDeferred": "The R 4.4.1 kernel for analysis.ipynb started once its interpreter was found",
			  "quartoInlineOutput": "The Quarto document analysis.ipynb needed a kernel for inline output",
			  "restartUninitializedSession": "A restart was requested for a session that never started",
			  "startupBehaviorAlways": "Startup Behavior is set to "Always" for R",
			  "startupBehaviorAlwaysAllLanguages": "Startup Behavior is set to "Always"",
			  "userSelectedRuntime": "You selected this interpreter",
			}
		`);
	});

	it('uses the extension ID when the extension is not registered', () => {
		expect(getSessionStartReasonLabel(createSession('detail', SessionStartReasonId.ExtensionRecommendedRuntime, 'example.missing'), extensions))
			.toBe('The example.missing extension recommended starting R 4.4.1 for this workspace');
	});

	it('has no label when the session has no start reason ID', () => {
		// Sessions persisted before start reason IDs existed only have a description.
		expect(getSessionStartReasonLabel(createSession('Affiliated Python runtime for workspace'), extensions))
			.toBeUndefined();
	});

	it('has no label when the start reason ID is unknown', () => {
		// A session persisted by a newer version can carry an ID this version doesn't know.
		expect(getSessionStartReasonLabel(createSession('Started by a future feature', 'futureReason' as SessionStartReasonId), extensions))
			.toBeUndefined();
	});
});

describe('describeSessionStartReason', () => {
	const runtime = stubInterface<ILanguageRuntimeMetadata>({
		languageName: 'R',
		runtimeName: 'R 4.4.1',
		extensionId: new ExtensionIdentifier('positron.positron-r'),
	});
	const notebookUri = URI.file('/work/analysis.ipynb');

	it('names extensions by ID', () => {
		expect(describeSessionStartReason({ id: SessionStartReasonId.ExtensionRecommendedRuntime }, runtime))
			.toBe('The positron.positron-r extension recommended starting R 4.4.1 for this workspace');
	});

	it('matches the popup label when the popup has no display names to use', () => {
		const session = {
			runtimeMetadata: runtime,
			metadata: stubInterface<IRuntimeSessionMetadata>({ notebookUri }),
		};
		for (const id of Object.values(SessionStartReasonId)) {
			const label = getSessionStartReasonLabel({ ...session, metadata: { ...session.metadata, startReasonId: id } }, []);
			expect(describeSessionStartReason({ id }, runtime, notebookUri), id).toBe(label);
		}
	});
});
