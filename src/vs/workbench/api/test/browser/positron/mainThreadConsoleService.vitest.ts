/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ILanguageRuntimeMetadata, LanguageRuntimeSessionMode } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeSessionMetadata } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { TestPositronConsoleInstance, TestPositronConsoleService } from '../../../../services/positronConsole/test/browser/testPositronConsoleService.js';
import { IExtHostContext } from '../../../../services/extensions/common/extHostCustomers.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { MainThreadConsoleService } from '../../../browser/positron/mainThreadConsoleService.js';
import { ExtHostConsoleServiceShape } from '../../../common/positron/extHost.positron.protocol.js';
import { SingleProxyRPCProtocol } from '../../common/testRPCProtocol.js';
import { ConsoleEditorTestServices } from './consoleEditorTestServices.js';

// A record of every `$setActiveConsoleEditor` call the main thread made, paired with whether the
// extension host could have resolved that editor at the time of the call. `resolvable: false`
// means `positron.window.activeConsoleEditor` would have been `undefined` when the
// `onDidChangeActiveConsoleEditor` event fired -- the bug this suite guards against.
interface IActiveEditorNotification {
	editorId: string | null;
	resolvable: boolean;
}

// Tests for the notification side of `positron.window.activeConsoleEditor`: the main thread must
// only tell the extension host about a console editor once that editor has actually been
// registered, which is deferred until the console input attaches its text model.
describe('MainThreadConsoleService (active console editor)', () => {

	ensureNoLeakedDisposables();

	let services: ConsoleEditorTestServices;
	let consoleService: TestPositronConsoleService;
	let mainThreadConsoleService: MainThreadConsoleService;
	let notifications: IActiveEditorNotification[];

	beforeEach(() => {
		services = new ConsoleEditorTestServices();
		notifications = [];

		const proxy = stubInterface<ExtHostConsoleServiceShape>({
			$addConsole: vi.fn(),
			$onDidChangeActiveConsole: vi.fn(),
			$setActiveConsoleEditor: (editorId: string | null) => {
				notifications.push({
					editorId,
					resolvable: editorId !== null && services.documentsAndEditors.getEditor(editorId) !== undefined
				});
			}
		});
		const extHostContext: IExtHostContext = {
			...SingleProxyRPCProtocol(proxy),
			// `getRaw` is generic over the proxy identifier, so the cast is what tells the
			// compiler which actor this test hands back -- the console editor manager.
			getRaw: <T, R extends T>(): R => services.documentsAndEditors as unknown as R,
		};

		consoleService = new TestPositronConsoleService();
		mainThreadConsoleService = new MainThreadConsoleService(extHostContext, consoleService);
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
		const editor = services.createCodeEditor(undefined);
		instance.setCodeEditor(editor);
		editor.setModel(services.createModel('> '));
		return instance;
	}

	it('waits for the editor to exist before announcing it to the ext host', () => {
		const instance = createInstance('session-1');
		consoleService.addTestConsoleInstance(instance);
		consoleService.setActivePositronConsoleSession('session-1');

		// The console is active but has no input editor yet, so there is nothing to announce.
		expect(notifications).toEqual([]);

		// The console input assigns its code editor before attaching a text model. Registration
		// with the ext host is deferred until the model arrives, so announcing the editor here
		// would fire `onDidChangeActiveConsoleEditor` with an unresolvable editor -- and, since
		// there is no second notification, extensions would never see the usable one.
		const editor = services.createCodeEditor(undefined);
		instance.setCodeEditor(editor);
		expect(notifications).toEqual([]);
		expect(services.consoleAdds('console-session-1')).toHaveLength(0);

		// Attaching the model completes registration; only now is the editor announced.
		editor.setModel(services.createModel('> '));
		expect(notifications).toEqual([{ editorId: 'console-session-1', resolvable: true }]);
	});

	it('announces the editor of each console as it becomes active', () => {
		// Each console announces itself once mounted, since adding it also makes it active.
		addMountedConsole('session-a');
		addMountedConsole('session-b');

		consoleService.setActivePositronConsoleSession('session-a');
		consoleService.setActivePositronConsoleSession('session-b');
		// Re-activating the console that is already announced is not a change.
		consoleService.setActivePositronConsoleSession('session-b');

		expect(notifications).toEqual([
			{ editorId: 'console-session-a', resolvable: true },
			{ editorId: 'console-session-b', resolvable: true },
			{ editorId: 'console-session-a', resolvable: true },
			{ editorId: 'console-session-b', resolvable: true },
		]);
	});

	it('clears the announced editor when the newly active console has none yet', () => {
		addMountedConsole('session-a');

		// A console whose input has not mounted becomes active: the ext host must stop reporting
		// the previous console's editor rather than hold on to a stale one.
		const pending = createInstance('session-pending');
		consoleService.addTestConsoleInstance(pending);
		consoleService.setActivePositronConsoleSession('session-pending');

		expect(notifications).toEqual([
			{ editorId: 'console-session-a', resolvable: true },
			{ editorId: null, resolvable: false },
		]);

		// Once its editor mounts, the pending console announces it.
		const editor = services.createCodeEditor(undefined);
		pending.setCodeEditor(editor);
		editor.setModel(services.createModel('> '));

		expect(notifications).toHaveLength(3);
		expect(notifications[2]).toEqual({ editorId: 'console-session-pending', resolvable: true });
	});
});
