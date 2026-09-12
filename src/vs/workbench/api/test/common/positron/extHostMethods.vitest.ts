/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import type * as vscode from 'vscode';
import { mock } from '../../../../../base/test/common/mock.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ExtHostCommands } from '../../../common/extHostCommands.js';
import { ExtHostDocuments } from '../../../common/extHostDocuments.js';
import { ExtHostEditors } from '../../../common/extHostTextEditors.js';
import { ExtHostQuickOpen } from '../../../common/extHostQuickOpen.js';
import { Range } from '../../../common/extHostTypes.js';
import { ExtHostWorkspace } from '../../../common/extHostWorkspace.js';
import { IMainPositronContext } from '../../../common/positron/extHost.positron.protocol.js';
import { ExtHostConsoleService } from '../../../common/positron/extHostConsoleService.js';
import { ExtHostContextKeyService } from '../../../common/positron/extHostContextKeyService.js';
import { ExtHostLanguageRuntime } from '../../../common/positron/extHostLanguageRuntime.js';
import { ExtHostMethods } from '../../../common/positron/extHostMethods.js';
import { ExtHostModalDialogs } from '../../../common/positron/extHostModalDialogs.js';

/** A minimal fake `vscode.TextEditor` over a single-line document, with edits recorded. */
function createFakeEditor(fileName: string, text = 'hello'): vscode.TextEditor & { readonly editedRanges: unknown[] } {
	const editedRanges: unknown[] = [];
	const document = {
		fileName,
		eol: 1, // vscode.EndOfLine.LF
		isClosed: false,
		isDirty: false,
		isUntitled: false,
		languageId: 'r',
		lineCount: 1,
		version: 1,
		lineAt: () => ({ text }),
		getText: () => text,
	};
	const selection = { active: { line: 0, character: 0 }, start: { line: 0, character: 0 }, end: { line: 0, character: text.length } };
	const editor = {
		document,
		selections: [selection],
		edit: (callback: (editBuilder: { replace: (location: unknown, value: string) => void }) => void) => {
			callback({ replace: (location, value) => editedRanges.push({ location, value }) });
			return Promise.resolve(true);
		},
		editedRanges,
	};
	return editor as unknown as vscode.TextEditor & { readonly editedRanges: unknown[] };
}

function createMethods(options: {
	paneEditor?: vscode.TextEditor;
	consoleEditor?: vscode.TextEditor;
	activeConsoleSessionId?: string;
	consoleFocused?: boolean;
}) {
	const editors = new class extends mock<ExtHostEditors>() {
		override getActiveTextEditor(): vscode.TextEditor | undefined {
			return options.paneEditor;
		}
	};
	const contextKeys = new class extends mock<ExtHostContextKeyService>() {
		override evaluateWhenClause(_whenClause: string): Promise<boolean> {
			return Promise.resolve(options.consoleFocused ?? false);
		}
	};
	const consoleService = new class extends mock<ExtHostConsoleService>() {
		override get activeConsoleSessionId(): string | undefined {
			return options.activeConsoleSessionId;
		}
		override get activeConsoleEditor(): vscode.TextEditor | undefined {
			return options.consoleEditor;
		}
	};

	return new ExtHostMethods(
		stubInterface<IMainPositronContext>({}),
		editors,
		new (mock<ExtHostDocuments>())(),
		new (mock<ExtHostModalDialogs>())(),
		new (mock<ExtHostLanguageRuntime>())(),
		new (mock<ExtHostWorkspace>())(),
		new (mock<ExtHostQuickOpen>())(),
		new (mock<ExtHostCommands>())(),
		contextKeys,
		consoleService,
	);
}

describe('ExtHostMethods', function () {

	describe('lastActiveEditorContext', function () {

		it('returns null when there is no editor pane and no console', async function () {
			const methods = createMethods({});
			expect(await methods.lastActiveEditorContext()).toBeNull();
		});

		it('returns the editor pane context when there is no caller session id', async function () {
			const paneEditor = createFakeEditor('/path/to/file.R');
			const methods = createMethods({ paneEditor, activeConsoleSessionId: 'session-1', consoleFocused: true });

			const context = await methods.lastActiveEditorContext();

			expect(context?.document.path).toBe('/path/to/file.R');
			expect(context?.id).toBeUndefined();
		});

		it('returns the console context when the caller session is the active console and it is focused', async function () {
			const consoleEditor = createFakeEditor('inmemory://repl-r-session-1', 'x <- 1');
			const paneEditor = createFakeEditor('/path/to/file.R');
			const methods = createMethods({
				paneEditor,
				consoleEditor,
				activeConsoleSessionId: 'session-1',
				consoleFocused: true,
			});

			const context = await methods.lastActiveEditorContext('session-1');

			expect(context?.document.path).toBe('');
			expect(context?.id).toBe('#console');
			expect(context?.contents).toEqual(['x <- 1']);
		});

		it('falls back to the editor pane when the caller session does not match the active console', async function () {
			const consoleEditor = createFakeEditor('inmemory://repl-python-session-2');
			const paneEditor = createFakeEditor('/path/to/file.R');
			const methods = createMethods({
				paneEditor,
				consoleEditor,
				activeConsoleSessionId: 'session-2',
				consoleFocused: true,
			});

			// A different (e.g. background) session calls in while the Python console is active.
			const context = await methods.lastActiveEditorContext('session-1');

			expect(context?.document.path).toBe('/path/to/file.R');
			expect(context?.id).toBeUndefined();
		});

		it('falls back to the editor pane when the console does not have keyboard focus', async function () {
			const consoleEditor = createFakeEditor('inmemory://repl-r-session-1');
			const paneEditor = createFakeEditor('/path/to/file.R');
			const methods = createMethods({
				paneEditor,
				consoleEditor,
				activeConsoleSessionId: 'session-1',
				consoleFocused: false,
			});

			const context = await methods.lastActiveEditorContext('session-1');

			expect(context?.document.path).toBe('/path/to/file.R');
			expect(context?.id).toBeUndefined();
		});
	});

	describe('modifyEditorLocations', function () {

		it('edits the editor pane when there is no caller session id', async function () {
			const paneEditor = createFakeEditor('/path/to/file.R');
			const consoleEditor = createFakeEditor('inmemory://repl-r-session-1');
			const methods = createMethods({ paneEditor, consoleEditor, activeConsoleSessionId: 'session-1', consoleFocused: true });

			await methods.modifyEditorLocations([new Range(0, 0, 0, 5)], ['x']);

			expect(paneEditor.editedRanges).toHaveLength(1);
			expect(consoleEditor.editedRanges).toHaveLength(0);
		});

		it('edits the console editor when the console is the caller session and has focus', async function () {
			const paneEditor = createFakeEditor('/path/to/file.R');
			const consoleEditor = createFakeEditor('inmemory://repl-r-session-1');
			const methods = createMethods({ paneEditor, consoleEditor, activeConsoleSessionId: 'session-1', consoleFocused: true });

			await methods.modifyEditorLocations([new Range(0, 0, 0, 5)], ['x'], 'session-1');

			expect(consoleEditor.editedRanges).toHaveLength(1);
			expect(paneEditor.editedRanges).toHaveLength(0);
		});
	});
});
