/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { mock } from '../../../../../base/test/common/mock.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { MainThreadConsoleServiceShape } from '../../../common/positron/extHost.positron.protocol.js';
import { ExtHostConsoleService } from '../../../common/positron/extHostConsoleService.js';
import { SingleProxyRPCProtocol } from '../testRPCProtocol.js';
import { ExtHostDocumentsAndEditors } from '../../../common/extHostDocumentsAndEditors.js';
import { ExtHostTextEditor } from '../../../common/extHostTextEditor.js';

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

/** Minimal DocsAndEditors stub; `idToEditor` maps editor id → the ExtHostTextEditor stub. */
function createDocsAndEditors(idToEditor: Record<string, ExtHostTextEditor> = {}) {
	return new class extends mock<ExtHostDocumentsAndEditors>() {
		override getEditor(id: string): ExtHostTextEditor | undefined {
			return idToEditor[id];
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

	describe('$setActiveConsoleEditor / activeConsoleEditor', function () {

		it('returns undefined initially', function () {
			const shape = createMockShape();
			const svc = new ExtHostConsoleService(SingleProxyRPCProtocol(shape), new NullLogService(), nullDocsAndEditors);
			expect(svc.activeConsoleEditor).toBeUndefined();
		});

		it('sets activeConsoleEditor from registered editor (derived via _activeConsoleSessionId)', function () {
			const fakeValue = Object.freeze({}) as import('vscode').TextEditor;
			const fakeExtEditor = { value: fakeValue } as unknown as ExtHostTextEditor;
			// getEditor key matches `console-${sessionId}` format used by the getter
			const docsAndEditors = createDocsAndEditors({ 'console-session-1': fakeExtEditor });

			const shape = createMockShape();
			const svc = new ExtHostConsoleService(SingleProxyRPCProtocol(shape), new NullLogService(), docsAndEditors);

			const fired: (import('vscode').TextEditor | undefined)[] = [];
			disposables.add(svc.onDidChangeActiveConsoleEditor((e) => fired.push(e)));

			// $onDidChangeActiveConsole sets _activeConsoleSessionId; $setActiveConsoleEditor fires the event
			svc.$onDidChangeActiveConsole('session-1');
			svc.$setActiveConsoleEditor('console-session-1');

			expect(svc.activeConsoleEditor).toBe(fakeValue);
			expect(fired).toEqual([fakeValue]);
		});

		it('clears activeConsoleEditor when session becomes null', function () {
			const fakeValue = Object.freeze({}) as import('vscode').TextEditor;
			const fakeExtEditor = { value: fakeValue } as unknown as ExtHostTextEditor;
			const docsAndEditors = createDocsAndEditors({ 'console-session-1': fakeExtEditor });

			const shape = createMockShape();
			const svc = new ExtHostConsoleService(SingleProxyRPCProtocol(shape), new NullLogService(), docsAndEditors);

			svc.$onDidChangeActiveConsole('session-1');
			svc.$setActiveConsoleEditor('console-session-1');
			expect(svc.activeConsoleEditor).toBe(fakeValue);

			const fired: (import('vscode').TextEditor | undefined)[] = [];
			disposables.add(svc.onDidChangeActiveConsoleEditor((e) => fired.push(e)));

			// Active console clears; $onDidChangeActiveConsole(undefined) precedes $setActiveConsoleEditor(null)
			svc.$onDidChangeActiveConsole(undefined);
			svc.$setActiveConsoleEditor(null);
			expect(svc.activeConsoleEditor).toBeUndefined();
			expect(fired).toEqual([undefined]);
		});

		it('yields undefined when no active session even with an editorId signal', function () {
			const shape = createMockShape();
			const svc = new ExtHostConsoleService(SingleProxyRPCProtocol(shape), new NullLogService(), nullDocsAndEditors);

			const fired: (import('vscode').TextEditor | undefined)[] = [];
			disposables.add(svc.onDidChangeActiveConsoleEditor((e) => fired.push(e)));

			// Without $onDidChangeActiveConsole, _activeConsoleSessionId is undefined
			svc.$setActiveConsoleEditor('console-session-1');
			expect(svc.activeConsoleEditor).toBeUndefined();
			expect(fired).toEqual([undefined]);
		});

		it('fires onDidChangeActiveConsoleEditor on each session change', function () {
			const fakeA = Object.freeze({}) as import('vscode').TextEditor;
			const fakeB = Object.freeze({}) as import('vscode').TextEditor;
			const docsAndEditors = createDocsAndEditors({
				'console-session-a': { value: fakeA } as unknown as ExtHostTextEditor,
				'console-session-b': { value: fakeB } as unknown as ExtHostTextEditor,
			});

			const shape = createMockShape();
			const svc = new ExtHostConsoleService(SingleProxyRPCProtocol(shape), new NullLogService(), docsAndEditors);

			const fired: (import('vscode').TextEditor | undefined)[] = [];
			disposables.add(svc.onDidChangeActiveConsoleEditor((e) => fired.push(e)));

			svc.$onDidChangeActiveConsole('session-a');
			svc.$setActiveConsoleEditor('console-session-a');
			svc.$onDidChangeActiveConsole('session-b');
			svc.$setActiveConsoleEditor('console-session-b');
			svc.$onDidChangeActiveConsole(undefined);
			svc.$setActiveConsoleEditor(null);

			expect(fired).toEqual([fakeA, fakeB, undefined]);
			expect(svc.activeConsoleEditor).toBeUndefined();
		});
	});
});
