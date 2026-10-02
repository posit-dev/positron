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
	const extensions = [
		stubInterface<IExtensionDescription>({
			identifier: new ExtensionIdentifier('positron.positron-r'),
			displayName: 'Positron R',
		}),
		stubInterface<IExtensionDescription>({
			identifier: new ExtensionIdentifier('posit.shiny'),
			displayName: 'Shiny',
		}),
	];

	function createSession(startReason: string, startReasonId?: SessionStartReasonId, extensionId = 'positron.positron-r', requestingExtensionId?: string) {
		return {
			runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({
				languageName: 'R',
				runtimeName: 'R 4.4.1',
				extensionId: new ExtensionIdentifier(extensionId),
			}),
			metadata: stubInterface<IRuntimeSessionMetadata>({
				startReason,
				startReasonId,
				requestingExtensionId,
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
			  "affiliatedRuntime": "Positron started the last interpreter used in this workspace",
			  "affiliatedRuntimeAtRegistration": "Positron found the last interpreter used in this workspace and started it",
			  "assistantRanCodeWithoutSession": "An AI assistant ran code with no R console open",
			  "codeExecutedWithoutSession": "Code was run with no R console open",
			  "duplicatedConsoleSession": "You duplicated a console",
			  "duplicatedNotebookSession": "You started a new console with a notebook's interpreter",
			  "extensionApiSelect": "An extension selected this interpreter",
			  "extensionApiStart": "An extension started this interpreter",
			  "extensionRecommendedRuntime": "The Positron R extension recommended this interpreter for this workspace",
			  "extensionRequestedImmediateStart": "The Positron R extension recommended this interpreter for this workspace",
			  "extensionRequestedStartAtRegistration": "The Positron R extension found this interpreter and recommended it for this workspace",
			  "languageFileOpened": "A file written in R was opened",
			  "languageFileOpenedAtRegistration": "A file written in R was opened",
			  "newConsoleCommand": "A command requested a new console for this interpreter",
			  "newFolderNotebook": "You created a new folder from the Jupyter Notebook template",
			  "notebookCellsExecuted": "Cells in analysis.ipynb were run with no kernel running",
			  "notebookCodeFragmentExecuted": "Selected code in analysis.ipynb was run with no kernel running",
			  "notebookEditorActivated": "You switched to analysis.ipynb or kept its preview tab open",
			  "notebookEditorOpened": "analysis.ipynb was opened",
			  "notebookKernelRestart": "Restart Kernel was used in analysis.ipynb with no kernel running",
			  "notebookKernelSelected": "The R 4.4.1 kernel was selected for analysis.ipynb",
			  "notebookKernelSelectionDeferred": "The R 4.4.1 kernel was selected for analysis.ipynb and started once Positron found it",
			  "quartoInlineOutput": "analysis.ipynb needed a kernel for inline output",
			  "restartUninitializedSession": "A restart was requested before this interpreter had started",
			  "startupBehaviorAlways": "Startup Behavior is set to "Always" for R",
			  "startupBehaviorAlwaysAllLanguages": "Startup Behavior is set to "Always"",
			  "userRanCodeWithoutSession": "You ran code with no R console open",
			  "userSelectedRuntime": "You selected this interpreter",
			}
		`);
	});

	it('uses the extension ID when the extension is not registered', () => {
		expect(getSessionStartReasonLabel(createSession('detail', SessionStartReasonId.ExtensionRecommendedRuntime, 'example.missing'), extensions))
			.toBe('The example.missing extension recommended this interpreter for this workspace');
	});

	it('names the extension that asked for the session', () => {
		const labels = [
			SessionStartReasonId.ExtensionApiStart,
			SessionStartReasonId.CodeExecutedWithoutSession,
			SessionStartReasonId.ExtensionApiSelect,
		].map(id => getSessionStartReasonLabel(createSession('detail', id, undefined, 'posit.shiny'), extensions));

		expect(labels).toEqual([
			'The Shiny extension started this interpreter',
			'The Shiny extension ran code with no R console open',
			'The Shiny extension selected this interpreter',
		]);
	});

	it('uses the requesting extension ID when the extension is not registered', () => {
		expect(getSessionStartReasonLabel(createSession('detail', SessionStartReasonId.ExtensionApiStart, undefined, 'example.missing'), extensions))
			.toBe('The example.missing extension started this interpreter');
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
		expect([
			describeSessionStartReason({ id: SessionStartReasonId.ExtensionRecommendedRuntime }, runtime),
			describeSessionStartReason({ id: SessionStartReasonId.ExtensionApiStart, requestingExtensionId: 'posit.shiny' }, runtime),
		]).toEqual([
			'The positron.positron-r extension recommended this interpreter for this workspace',
			'The posit.shiny extension started this interpreter',
		]);
	});

	it('matches the popup label when the popup has no display names to use', () => {
		const session = {
			runtimeMetadata: runtime,
			metadata: stubInterface<IRuntimeSessionMetadata>({ notebookUri }),
		};
		for (const id of Object.values(SessionStartReasonId)) {
			for (const requestingExtensionId of [undefined, 'posit.shiny']) {
				const label = getSessionStartReasonLabel({ ...session, metadata: { ...session.metadata, startReasonId: id, requestingExtensionId } }, []);
				expect(describeSessionStartReason({ id, requestingExtensionId }, runtime, notebookUri), id).toBe(label);
			}
		}
	});
});
