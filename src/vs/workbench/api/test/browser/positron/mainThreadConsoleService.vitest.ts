/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ILanguageRuntimeMetadata, LanguageRuntimeSessionMode } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeSessionMetadata } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { TestPositronConsoleInstance, TestPositronConsoleService } from '../../../../services/positronConsole/test/browser/testPositronConsoleService.js';
import { IExtHostContext } from '../../../../services/extensions/common/extHostCustomers.js';
import { ProxyIdentifier } from '../../../../services/extensions/common/proxyIdentifier.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { MainThreadConsoleService } from '../../../browser/positron/mainThreadConsoleService.js';
import { ExtHostConsoleServiceShape, MainPositronContext } from '../../../common/positron/extHost.positron.protocol.js';
import { SingleProxyRPCProtocol } from '../../common/testRPCProtocol.js';
import { ConsoleEditorTestServices } from './consoleEditorTestServices.js';

// The Positron-only console editor traffic the main thread sent to the (fake) extension host, in
// order. `resolvable` records whether the editor id in an `add` could be resolved on the main
// thread at the time of the call -- `false` would mean the extension host was handed an editor id
// it cannot use.
type ConsoleEditorCall =
	| { kind: 'add'; sessionId: string; editorId: string; resolvable: boolean }
	| { kind: 'remove'; sessionId: string }
	| { kind: 'activeConsole'; sessionId: string | undefined };

// Tests for `positron.window.activeConsoleEditor` as seen from the main thread: the console input
// editor must reach the extension host on the Positron-only console channel (never the core
// documents-and-editors delta), only once it actually has a text model, and must be retired when
// the Console view remounts or the console goes away.
describe('MainThreadConsoleService (console editors)', () => {

	ensureNoLeakedDisposables();

	let services: ConsoleEditorTestServices;
	let consoleService: TestPositronConsoleService;
	let mainThreadConsoleService: MainThreadConsoleService;
	let calls: ConsoleEditorCall[];

	/**
	 * An `IExtHostContext` that resolves raw actors the way `RPCProtocol` does: `getRaw` throws
	 * until the actor has been `set`. That ordering is the point -- `MainThreadConsoleService` is an
	 * `@extHostNamedCustomer` and the hidden editor manager is set by `MainThreadDocumentsAndEditors`,
	 * a plain `@extHostCustomer` constructed afterwards, so the actor is missing for the whole of
	 * `MainThreadConsoleService`'s constructor.
	 */
	function createExtHostContext(): IExtHostContext {
		const proxy = stubInterface<ExtHostConsoleServiceShape>({
			$addConsole: vi.fn(),
			$onDidChangeActiveConsole: (sessionId: string | undefined) => {
				calls.push({ kind: 'activeConsole', sessionId });
			},
			$addConsoleEditor: (sessionId, data) => {
				calls.push({
					kind: 'add',
					sessionId,
					editorId: data.id,
					resolvable: services.documentsAndEditors.getEditor(data.id) !== undefined
				});
			},
			$removeConsoleEditor: (sessionId: string) => {
				calls.push({ kind: 'remove', sessionId });
			},
			$acceptConsoleEditorPropertiesChanged: vi.fn()
		});
		const locals = new Map<string, unknown>();
		return {
			...SingleProxyRPCProtocol(proxy),
			set: <T, R extends T>(identifier: ProxyIdentifier<T>, instance: R): R => {
				locals.set(identifier.sid, instance);
				return instance;
			},
			getRaw: <T, R extends T>(identifier: ProxyIdentifier<T>): R => {
				const local = locals.get(identifier.sid);
				if (!local) {
					// Same failure as `RPCProtocol.getRaw`. Thrown from a customer's constructor it
					// leaves that customer's RPC channel unregistered entirely.
					throw new Error(`Missing actor ${identifier.sid}.`);
				}
				return local as R;
			}
		};
	}

	/** Registers the hidden editor manager, as the plain customer that owns it does. */
	function registerHiddenEditorManager(extHostContext: IExtHostContext): void {
		extHostContext.set(MainPositronContext.MainThreadHiddenEditorManager, services.documentsAndEditors);
	}

	/** Constructs the service the way `ExtensionHostManager` does: named customer, then the rest. */
	function createMainThreadConsoleService(): MainThreadConsoleService {
		const extHostContext = createExtHostContext();
		const service = new MainThreadConsoleService(extHostContext, consoleService);
		registerHiddenEditorManager(extHostContext);
		return service;
	}

	/**
	 * Lets the deferred constructor replay run, as it does once every customer is constructed.
	 */
	function flushDeferredReplay(): Promise<void> {
		return new Promise<void>((resolve) => setTimeout(resolve, 0));
	}

	beforeEach(async () => {
		services = new ConsoleEditorTestServices();
		calls = [];
		consoleService = new TestPositronConsoleService();
		mainThreadConsoleService = createMainThreadConsoleService();
		// Start each test from a settled service: no consoles exist yet, so the replay is a no-op,
		// but it must not still be pending while a test records calls.
		await flushDeferredReplay();
	});

	afterEach(() => {
		// Dispose the console registrations while the main-thread editor tracking is still alive.
		mainThreadConsoleService.dispose();
		services.dispose();
	});

	function createInstance(sessionId: string): TestPositronConsoleInstance {
		const sessionMetadata: IRuntimeSessionMetadata = {
			sessionId,
			sessionMode: LanguageRuntimeSessionMode.Console,
			notebookUri: undefined,
			createdTimestamp: 0,
			startReason: 'test',
		};
		const runtimeMetadata = stubInterface<ILanguageRuntimeMetadata>({ languageId: 'python' });
		return new TestPositronConsoleInstance(sessionId, 'Python', sessionMetadata, runtimeMetadata);
	}

	// Drives a console through the real mount sequence: the instance starts without a code editor,
	// the React input assigns one, and only then is a text model attached.
	function addMountedConsole(sessionId: string): TestPositronConsoleInstance {
		const instance = createInstance(sessionId);
		consoleService.addTestConsoleInstance(instance);
		mountEditor(instance);
		return instance;
	}

	function mountEditor(instance: TestPositronConsoleInstance) {
		const editor = services.createCodeEditor(undefined);
		instance.setCodeEditor(editor);
		editor.setModel(services.createModel('> '));
		return editor;
	}

	// A console whose input editor is already mounted by the time the service sees it -- what an
	// already-running console looks like after an extension host restart.
	function addPreMountedConsole(sessionId: string): TestPositronConsoleInstance {
		const instance = createInstance(sessionId);
		instance.codeEditor = services.createCodeEditor(services.createModel('> '));
		consoleService.addTestConsoleInstance(instance);
		return instance;
	}

	/** Only the console editor traffic, dropping the active-console bookkeeping. */
	function editorCalls(): ConsoleEditorCall[] {
		return calls.filter(call => call.kind !== 'activeConsole');
	}

	it('waits for the text model before announcing the editor to the ext host', () => {
		const instance = createInstance('session-1');
		consoleService.addTestConsoleInstance(instance);

		// The console exists but has no input editor yet, so there is nothing to announce.
		expect(editorCalls()).toEqual([]);

		// The console input assigns its code editor before attaching a text model. Announcing the
		// editor here would hand the ext host an editor id it cannot resolve.
		const editor = services.createCodeEditor(undefined);
		instance.setCodeEditor(editor);
		expect(editorCalls()).toEqual([]);

		// Attaching the model completes registration; only now is the editor announced.
		editor.setModel(services.createModel('> '));
		expect(editorCalls()).toEqual([
			{ kind: 'add', sessionId: 'session-1', editorId: 'console-session-1', resolvable: true }
		]);
	});

	it('keeps the console editor off the core documents-and-editors channel', () => {
		addMountedConsole('session-1');

		// The editor travels only over the Positron console channel, so it never appears in
		// `vscode.window.visibleTextEditors` or the core editor events (posit-dev/positron#780).
		expect(services.coreDeltaMentions('console-session-1')).toEqual([]);
		expect(services.coreEditorStateCalls('console-session-1')).toEqual([]);
	});

	it('re-registers the editor when the Console view remounts', () => {
		const instance = addMountedConsole('session-1');
		calls = [];

		// Remount: the old editor widget is disposed and a fresh one is assigned. Without the
		// re-registration the ext host would keep resolving the disposed editor and model.
		instance.codeEditor!.dispose();
		mountEditor(instance);

		expect(editorCalls()).toEqual([
			{ kind: 'remove', sessionId: 'session-1' },
			{ kind: 'add', sessionId: 'session-1', editorId: 'console-session-1', resolvable: true }
		]);
	});

	it('retires the editor when the console is deleted', () => {
		addMountedConsole('session-1');
		calls = [];

		consoleService.deletePositronConsoleSession('session-1');

		expect(editorCalls()).toEqual([{ kind: 'remove', sessionId: 'session-1' }]);
		expect(services.documentsAndEditors.getEditor('console-session-1')).toBeUndefined();
	});

	it('replays consoles that already exist, but only once every customer is constructed', async () => {
		// Simulates an extension host restart: the consoles are already running and will never
		// re-fire `onDidStartPositronConsoleInstance`.
		addMountedConsole('session-a');
		addMountedConsole('session-b');
		consoleService.setActivePositronConsoleSession('session-a');
		calls = [];

		const extHostContext = createExtHostContext();
		const replayed = new MainThreadConsoleService(extHostContext, consoleService);
		try {
			// Nothing yet. The console input's document only reaches the extension host in the
			// initial documents-and-editors delta, which the customer registering the hidden editor
			// manager sends from its own constructor -- i.e. after this one has run. Announcing an
			// editor here would arrive ahead of its document and the extension host would drop it.
			expect(calls).toEqual([]);

			registerHiddenEditorManager(extHostContext);
			await flushDeferredReplay();

			expect(calls).toEqual([
				{ kind: 'add', sessionId: 'session-a', editorId: 'console-session-a', resolvable: true },
				{ kind: 'add', sessionId: 'session-b', editorId: 'console-session-b', resolvable: true },
				{ kind: 'activeConsole', sessionId: 'session-a' },
			]);
		} finally {
			replayed.dispose();
		}
	});

	it('registers editors even though the hidden editor manager does not exist yet while it constructs', async () => {
		// Drop the service created in `beforeEach` so only the one under test reports traffic.
		mainThreadConsoleService.dispose();

		const extHostContext = createExtHostContext();
		// Named customers are constructed first, so resolving the manager here throws -- and the
		// customer loop swallows constructor errors, so an eager `getRaw` would silently leave this
		// service's whole RPC channel (`$getConsoleWidth`, `$tryPasteText`, ...) unregistered.
		expect(() => extHostContext.getRaw(MainPositronContext.MainThreadHiddenEditorManager)).toThrow();
		mainThreadConsoleService = new MainThreadConsoleService(extHostContext, consoleService);
		registerHiddenEditorManager(extHostContext);
		await flushDeferredReplay();
		calls = [];

		addMountedConsole('session-1');

		expect(editorCalls()).toEqual([
			{ kind: 'add', sessionId: 'session-1', editorId: 'console-session-1', resolvable: true }
		]);
	});

	it('replaces the registration when the console input swaps in a new editor', () => {
		const instance = addMountedConsole('session-1');
		calls = [];

		// A fresh editor is assigned while the previous one is still alive (the Console view
		// re-created it without disposing the old widget first).
		const replacement = services.createCodeEditor(services.createModel('> '));
		instance.setCodeEditor(replacement);

		// The old registration must be retired first: it shares the editor id with its replacement,
		// so cleaning it up afterwards would retire the new editor instead.
		expect(editorCalls()).toEqual([
			{ kind: 'remove', sessionId: 'session-1' },
			{ kind: 'add', sessionId: 'session-1', editorId: 'console-session-1', resolvable: true }
		]);
		expect(services.documentsAndEditors.getEditor('console-session-1')?.getCodeEditor()).toBe(replacement);
	});

	it('retires the previous tracking when the same session id is registered again', () => {
		addMountedConsole('session-1');
		calls = [];

		// The console instance for this session is replaced in place, and its editor is already
		// mounted, so the new registration exists before the old tracking is torn down.
		const replacement = addPreMountedConsole('session-1');

		expect(editorCalls()).toEqual([
			{ kind: 'remove', sessionId: 'session-1' },
			{ kind: 'add', sessionId: 'session-1', editorId: 'console-session-1', resolvable: true }
		]);
		expect(services.documentsAndEditors.getEditor('console-session-1')?.getCodeEditor())
			.toBe(replacement.codeEditor);
	});

	it('announces each console as it becomes active', () => {
		addMountedConsole('session-a');
		addMountedConsole('session-b');
		calls = [];

		consoleService.setActivePositronConsoleSession('session-a');
		consoleService.setActivePositronConsoleSession('session-b');

		// The extension host derives the active console editor from the active session, so the
		// main thread only has to report which console is active.
		expect(calls).toEqual([
			{ kind: 'activeConsole', sessionId: 'session-a' },
			{ kind: 'activeConsole', sessionId: 'session-b' },
		]);
	});
});
