/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { RenderLineNumbersType, TextEditorCursorStyle } from '../../../../../editor/common/config/editorOptions.js';
import { Selection } from '../../../../../editor/common/core/selection.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { ITextEditorAddData } from '../../../common/extHost.protocol.js';
import { MainThreadConsoleServiceShape } from '../../../common/positron/extHost.positron.protocol.js';
import { ExtHostConsoleService } from '../../../common/positron/extHostConsoleService.js';
import { SingleProxyRPCProtocol } from '../testRPCProtocol.js';
import { ExtHostDocumentData } from '../../../common/extHostDocumentData.js';
import { ExtHostDocumentsAndEditors } from '../../../common/extHostDocumentsAndEditors.js';

function createMockShape(activeSessionId: string | undefined = undefined) {
	return new class extends mock<MainThreadConsoleServiceShape>() {
		private _activeSessionId = activeSessionId;
		override $getActiveConsoleSessionId(): Promise<string | undefined> {
			return Promise.resolve(this._activeSessionId);
		}
		override $getConsoleWidth(): Promise<number> {
			return Promise.resolve(80);
		}
		override $getSessionIdForLanguage(_languageId: string): Promise<string | undefined> {
			return Promise.resolve(undefined);
		}
		override $tryPasteText(_sessionId: string, _text: string): void {
			// no-op
		}
	};
}

// Returns a shape whose $getActiveConsoleSessionId promise is manually resolved via the
// returned callback — lets tests control when the startup seed arrives.
function createControllableMockShape() {
	let resolve: (sessionId: string | undefined) => void;
	const shape = new class extends mock<MainThreadConsoleServiceShape>() {
		override $getActiveConsoleSessionId(): Promise<string | undefined> {
			return new Promise((r) => { resolve = r; });
		}
		override $getConsoleWidth(): Promise<number> {
			return Promise.resolve(80);
		}
		override $getSessionIdForLanguage(_languageId: string): Promise<string | undefined> {
			return Promise.resolve(undefined);
		}
		override $tryPasteText(_sessionId: string, _text: string): void {
			// no-op
		}
	};
	return { shape, resolveActiveSessionId: (id: string | undefined) => resolve(id) };
}

/** The console input document URI for `sessionId`, as the main thread would report it. */
function documentUri(sessionId: string): URI {
	return URI.from({ scheme: 'inmemory', path: `/repl-python-${sessionId}` });
}

/**
 * A `$addConsoleEditor` payload for `sessionId`, mirroring what the main thread derives from the
 * console input's `MainThreadTextEditor`.
 */
function createEditorAddData(sessionId: string): ITextEditorAddData {
	return {
		id: `console-${sessionId}`,
		documentUri: documentUri(sessionId),
		options: {
			tabSize: 4,
			indentSize: 4,
			originalIndentSize: 4,
			insertSpaces: true,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.Off
		},
		selections: [{ selectionStartLineNumber: 1, selectionStartColumn: 1, positionLineNumber: 1, positionColumn: 1 }],
		visibleRanges: [],
		editorPosition: undefined
	};
}

/**
 * Minimal DocsAndEditors stub. `ExtHostConsoleService` builds its own `ExtHostTextEditor` for each
 * console editor, so all it needs from here is the document behind the editor's URI.
 */
function createDocsAndEditors(sessionIds: string[] = []) {
	const documents = new Map(sessionIds.map(sessionId => [
		documentUri(sessionId).toString(),
		stubInterface<ExtHostDocumentData>({
			document: stubInterface<import('vscode').TextDocument>({ uri: documentUri(sessionId) })
		})
	]));
	return new class extends mock<ExtHostDocumentsAndEditors>() {
		override getDocument(uri: URI): ExtHostDocumentData | undefined {
			return documents.get(uri.toString());
		}
	};
}

const nullDocsAndEditors = createDocsAndEditors();

describe('ExtHostConsoleService', function () {

	const disposables = ensureNoLeakedDisposables();

	it('normal order: $addConsole then $onDidChangeActiveConsole resolves activeConsole', function () {
		const shape = createMockShape();
		const svc = new ExtHostConsoleService(SingleProxyRPCProtocol(shape), new NullLogService(), nullDocsAndEditors);

		const fired: (import('positron').Console | undefined)[] = [];
		disposables.add(svc.onDidChangeActiveConsole((c) => fired.push(c)));

		svc.$addConsole('session-1');
		svc.$onDidChangeActiveConsole('session-1');

		expect(svc.activeConsole).toBeDefined();
		expect(fired.length).toBe(1);
		expect(fired[0]).toBe(svc.activeConsole);
	});

	it('race condition: $onDidChangeActiveConsole before $addConsole fires again on $addConsole', function () {
		const shape = createMockShape();
		const svc = new ExtHostConsoleService(SingleProxyRPCProtocol(shape), new NullLogService(), nullDocsAndEditors);

		const fired: (import('positron').Console | undefined)[] = [];
		disposables.add(svc.onDidChangeActiveConsole((c) => fired.push(c)));

		// Active session arrives before the console is registered
		svc.$onDidChangeActiveConsole('session-1');
		expect(svc.activeConsole).toBeUndefined();
		expect(fired).toEqual([undefined]);

		// Console is registered later — should re-fire with the resolved console
		svc.$addConsole('session-1');
		expect(svc.activeConsole).toBeDefined();
		expect(fired.length).toBe(2);
		expect(fired[1]).toBe(svc.activeConsole);
	});

	it('$onDidChangeActiveConsole(undefined) clears activeConsole and fires with undefined', function () {
		const shape = createMockShape();
		const svc = new ExtHostConsoleService(SingleProxyRPCProtocol(shape), new NullLogService(), nullDocsAndEditors);

		svc.$addConsole('session-1');
		svc.$onDidChangeActiveConsole('session-1');
		expect(svc.activeConsole).toBeDefined();

		const fired: (import('positron').Console | undefined)[] = [];
		disposables.add(svc.onDidChangeActiveConsole((c) => fired.push(c)));

		svc.$onDidChangeActiveConsole(undefined);
		expect(svc.activeConsole).toBeUndefined();
		expect(fired).toEqual([undefined]);
	});

	it('unknown sessionId: activeConsole is undefined when sessionId is not registered', function () {
		const shape = createMockShape();
		const svc = new ExtHostConsoleService(SingleProxyRPCProtocol(shape), new NullLogService(), nullDocsAndEditors);

		const fired: (import('positron').Console | undefined)[] = [];
		disposables.add(svc.onDidChangeActiveConsole((c) => fired.push(c)));

		svc.$onDidChangeActiveConsole('session-unknown');
		expect(svc.activeConsole).toBeUndefined();
		expect(fired).toEqual([undefined]);
	});

	it('startup race: $addConsole before $getActiveConsoleSessionId resolves still fires event', async function () {
		const { shape, resolveActiveSessionId } = createControllableMockShape();
		const svc = new ExtHostConsoleService(SingleProxyRPCProtocol(shape), new NullLogService(), nullDocsAndEditors);

		const fired: (import('positron').Console | undefined)[] = [];
		disposables.add(svc.onDidChangeActiveConsole((c) => fired.push(c)));

		// Console registers BEFORE the startup promise resolves
		svc.$addConsole('session-preexisting');
		expect(svc.activeConsole).toBeUndefined();
		expect(fired).toHaveLength(0);

		// Startup promise resolves — should set active and fire the event
		resolveActiveSessionId('session-preexisting');
		await new Promise<void>((resolve) => setTimeout(resolve, 0));

		expect(svc.activeConsole).toBeDefined();
		expect(fired).toHaveLength(1);
		expect(fired[0]).toBe(svc.activeConsole);
	});

	it('startup race: live $onDidChangeActiveConsole before $getActiveConsoleSessionId resolves wins', async function () {
		const { shape, resolveActiveSessionId } = createControllableMockShape();
		const svc = new ExtHostConsoleService(SingleProxyRPCProtocol(shape), new NullLogService(), nullDocsAndEditors);

		svc.$addConsole('session-1');
		svc.$addConsole('session-stale');

		const fired: (import('positron').Console | undefined)[] = [];
		disposables.add(svc.onDidChangeActiveConsole((c) => fired.push(c)));

		// Live event fires: session-1 is the active console
		svc.$onDidChangeActiveConsole('session-1');
		const activeFromLiveEvent = svc.activeConsole;
		expect(activeFromLiveEvent).toBeDefined();
		expect(fired).toHaveLength(1);

		// Startup promise resolves with a stale session ID — must not overwrite
		resolveActiveSessionId('session-stale');
		await new Promise<void>((resolve) => setTimeout(resolve, 0));

		expect(svc.activeConsole).toBe(activeFromLiveEvent);
		expect(fired).toHaveLength(1); // no spurious second event
	});

	it('logs instead of rejecting when the startup seed fails', async function () {
		const shape = new class extends mock<MainThreadConsoleServiceShape>() {
			override $getActiveConsoleSessionId(): Promise<string | undefined> {
				return Promise.reject(new Error('extension host was torn down'));
			}
		};
		const logService = new NullLogService();
		const error = vi.spyOn(logService, 'error');

		// An unhandled rejection here would surface as an extension host error with no context.
		const svc = new ExtHostConsoleService(SingleProxyRPCProtocol(shape), logService, nullDocsAndEditors);
		await new Promise<void>((resolve) => setTimeout(resolve, 0));

		expect(error).toHaveBeenCalledOnce();
		expect(svc.activeConsole).toBeUndefined();
	});

	it('constructor seeds _activeConsoleSessionId from $getActiveConsoleSessionId', async function () {
		const shape = createMockShape('session-preexisting');
		const svc = new ExtHostConsoleService(SingleProxyRPCProtocol(shape), new NullLogService(), nullDocsAndEditors);

		// Wait for the async init promise to resolve
		await new Promise<void>((resolve) => setTimeout(resolve, 0));

		// Adding a console with the pre-existing session ID should re-fire the event
		const fired: (import('positron').Console | undefined)[] = [];
		disposables.add(svc.onDidChangeActiveConsole((c) => fired.push(c)));

		svc.$addConsole('session-preexisting');
		expect(svc.activeConsole).toBeDefined();
		expect(fired.length).toBe(1);
		expect(fired[0]).toBe(svc.activeConsole);
	});

	describe('console editors / activeConsoleEditor', function () {

		it('returns undefined initially', function () {
			const shape = createMockShape();
			const svc = new ExtHostConsoleService(SingleProxyRPCProtocol(shape), new NullLogService(), nullDocsAndEditors);
			expect(svc.activeConsoleEditor).toBeUndefined();
		});

		it('resolves the active console editor once the editor is registered', function () {
			const shape = createMockShape();
			const svc = new ExtHostConsoleService(SingleProxyRPCProtocol(shape), new NullLogService(), createDocsAndEditors(['session-1']));

			const fired: (import('vscode').TextEditor | undefined)[] = [];
			disposables.add(svc.onDidChangeActiveConsoleEditor((e) => fired.push(e)));

			svc.$onDidChangeActiveConsole('session-1');
			// No editor yet: the console input mounts separately, so nothing to report.
			expect(svc.activeConsoleEditor).toBeUndefined();
			expect(fired).toEqual([]);

			svc.$addConsoleEditor('session-1', createEditorAddData('session-1'));

			expect(svc.activeConsoleEditor?.document.uri).toEqual(documentUri('session-1'));
			expect(fired).toEqual([svc.activeConsoleEditor]);
		});

		it('resolves when the editor is registered before the console becomes active', function () {
			const shape = createMockShape();
			const svc = new ExtHostConsoleService(SingleProxyRPCProtocol(shape), new NullLogService(), createDocsAndEditors(['session-1']));

			const fired: (import('vscode').TextEditor | undefined)[] = [];
			disposables.add(svc.onDidChangeActiveConsoleEditor((e) => fired.push(e)));

			svc.$addConsoleEditor('session-1', createEditorAddData('session-1'));
			expect(svc.activeConsoleEditor).toBeUndefined();
			expect(fired).toEqual([]);

			svc.$onDidChangeActiveConsole('session-1');
			expect(svc.activeConsoleEditor).toBeDefined();
			expect(fired).toEqual([svc.activeConsoleEditor]);
		});

		it('clears the active console editor when the console is no longer active', function () {
			const shape = createMockShape();
			const svc = new ExtHostConsoleService(SingleProxyRPCProtocol(shape), new NullLogService(), createDocsAndEditors(['session-1']));

			svc.$addConsoleEditor('session-1', createEditorAddData('session-1'));
			svc.$onDidChangeActiveConsole('session-1');
			expect(svc.activeConsoleEditor).toBeDefined();

			const fired: (import('vscode').TextEditor | undefined)[] = [];
			disposables.add(svc.onDidChangeActiveConsoleEditor((e) => fired.push(e)));

			svc.$onDidChangeActiveConsole(undefined);
			expect(svc.activeConsoleEditor).toBeUndefined();
			expect(fired).toEqual([undefined]);
		});

		it('clears the active console editor when the editor is removed', function () {
			const shape = createMockShape();
			const svc = new ExtHostConsoleService(SingleProxyRPCProtocol(shape), new NullLogService(), createDocsAndEditors(['session-1']));

			svc.$addConsoleEditor('session-1', createEditorAddData('session-1'));
			svc.$onDidChangeActiveConsole('session-1');

			const fired: (import('vscode').TextEditor | undefined)[] = [];
			disposables.add(svc.onDidChangeActiveConsoleEditor((e) => fired.push(e)));

			// The Console view unmounted, or the console was deleted.
			svc.$removeConsoleEditor('session-1');
			expect(svc.activeConsoleEditor).toBeUndefined();
			expect(fired).toEqual([undefined]);
		});

		it('re-registering replaces the editor, so a remount is not left pointing at the old one', function () {
			const shape = createMockShape();
			const svc = new ExtHostConsoleService(SingleProxyRPCProtocol(shape), new NullLogService(), createDocsAndEditors(['session-1']));

			svc.$addConsoleEditor('session-1', createEditorAddData('session-1'));
			svc.$onDidChangeActiveConsole('session-1');
			const firstEditor = svc.activeConsoleEditor;

			const fired: (import('vscode').TextEditor | undefined)[] = [];
			disposables.add(svc.onDidChangeActiveConsoleEditor((e) => fired.push(e)));

			// The Console view remounted: the main thread retires the old registration and sends a
			// new one for the freshly created editor.
			svc.$removeConsoleEditor('session-1');
			svc.$addConsoleEditor('session-1', createEditorAddData('session-1'));

			expect(svc.activeConsoleEditor).not.toBe(firstEditor);
			expect(fired).toEqual([undefined, svc.activeConsoleEditor]);
		});

		it('fires once per change as the active console moves between consoles', function () {
			const shape = createMockShape();
			const svc = new ExtHostConsoleService(SingleProxyRPCProtocol(shape), new NullLogService(), createDocsAndEditors(['session-a', 'session-b']));

			svc.$addConsoleEditor('session-a', createEditorAddData('session-a'));
			svc.$addConsoleEditor('session-b', createEditorAddData('session-b'));

			const fired: (import('vscode').TextEditor | undefined)[] = [];
			disposables.add(svc.onDidChangeActiveConsoleEditor((e) => fired.push(e)));

			svc.$onDidChangeActiveConsole('session-a');
			const editorA = svc.activeConsoleEditor;
			svc.$onDidChangeActiveConsole('session-b');
			const editorB = svc.activeConsoleEditor;
			// Re-activating the console that is already reported is not a change.
			svc.$onDidChangeActiveConsole('session-b');
			svc.$onDidChangeActiveConsole(undefined);

			expect(fired).toEqual([editorA, editorB, undefined]);
			expect(svc.activeConsoleEditor).toBeUndefined();
		});

		it('applies selection changes to the console editor without touching core editor events', function () {
			const shape = createMockShape();
			const svc = new ExtHostConsoleService(SingleProxyRPCProtocol(shape), new NullLogService(), createDocsAndEditors(['session-1']));

			svc.$addConsoleEditor('session-1', createEditorAddData('session-1'));
			svc.$onDidChangeActiveConsole('session-1');

			svc.$acceptConsoleEditorPropertiesChanged('session-1', {
				options: null,
				visibleRanges: null,
				selections: { source: 'api', selections: [new Selection(1, 1, 1, 4)] }
			});

			const selection = svc.activeConsoleEditor!.selection;
			expect({
				start: [selection.start.line, selection.start.character],
				end: [selection.end.line, selection.end.character]
			}).toEqual({ start: [0, 0], end: [0, 3] });
		});

		it('ignores editor traffic for an unknown session', function () {
			const shape = createMockShape();
			const svc = new ExtHostConsoleService(SingleProxyRPCProtocol(shape), new NullLogService(), nullDocsAndEditors);

			const fired: (import('vscode').TextEditor | undefined)[] = [];
			disposables.add(svc.onDidChangeActiveConsoleEditor((e) => fired.push(e)));

			// No document for this session, so no editor can be built.
			svc.$addConsoleEditor('session-1', createEditorAddData('session-1'));
			svc.$removeConsoleEditor('session-1');
			svc.$acceptConsoleEditorPropertiesChanged('session-1', {
				options: createEditorAddData('session-1').options,
				selections: null,
				visibleRanges: null
			});

			expect(svc.activeConsoleEditor).toBeUndefined();
			expect(fired).toEqual([]);
		});
	});
});
