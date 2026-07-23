/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { TestRuntimeStartupService } from '../../../../services/runtimeStartup/test/common/testRuntimeStartupService.js';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService, LanguageRuntimeSessionMode, LanguageRuntimeStartupBehavior, LanguageRuntimeSessionLocation, RuntimeExitReason, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, INotebookLanguageRuntimeSession, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IQuartoDocumentModel } from '../../common/quartoTypes.js';
import { IQuartoDocumentModelService } from '../../browser/quartoDocumentModelService.js';
import { IQuartoOutputCacheService } from '../../common/quartoExecutionTypes.js';
import { QuartoKernelManager, QuartoKernelState } from '../../browser/quartoKernelManager.js';
import { IEditorIdentifier, IEditorCloseEvent } from '../../../../common/editor.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';

function makeRuntime(id: string, languageId: string, name: string): ILanguageRuntimeMetadata {
	return {
		base64EncodedIconSvg: '',
		extensionId: new ExtensionIdentifier('test.extension'),
		extraRuntimeData: {},
		languageId,
		runtimeId: id,
		runtimeName: name,
		languageName: languageId,
		languageVersion: '1.0.0',
		runtimePath: `/path/to/${id}`,
		runtimeShortName: name,
		runtimeSource: 'test',
		runtimeVersion: '1.0.0',
		sessionLocation: LanguageRuntimeSessionLocation.Machine,
		startupBehavior: LanguageRuntimeStartupBehavior.Explicit,
	};
}

const pythonRuntime1 = makeRuntime('python-3.11', 'python', 'Python 3.11');
const pythonRuntime2 = makeRuntime('python-3.12', 'python', 'Python 3.12');
const rRuntime1 = makeRuntime('r-4.4', 'r', 'R 4.4');

const docUri = URI.file('/test/doc.qmd');

describe('QuartoKernelManager', () => {
	const disposables = ensureNoLeakedDisposables();

	let kernelManager: QuartoKernelManager;
	let runtimeStartupService: TestRuntimeStartupService;
	let storageService: InMemoryStorageService;

	// Track calls to startNewRuntimeSession
	let startedRuntimeIds: string[];
	let shutdownUris: URI[];
	let nextSessionId: number;

	// Mutable state for mocks that tests can override
	let primaryLanguage: string;
	let registeredRuntimes: ILanguageRuntimeMetadata[];

	const allRuntimes = [pythonRuntime1, pythonRuntime2, rRuntime1];

	function findRuntimeById(id: string): ILanguageRuntimeMetadata {
		return allRuntimes.find(r => r.runtimeId === id) ?? pythonRuntime1;
	}

	beforeEach(() => {
		runtimeStartupService = new TestRuntimeStartupService();
		runtimeStartupService.setPreferredRuntime('python', pythonRuntime1);
		runtimeStartupService.setPreferredRuntime('r', rRuntime1);

		storageService = disposables.add(new InMemoryStorageService());

		startedRuntimeIds = [];
		shutdownUris = [];
		nextSessionId = 0;
		primaryLanguage = 'python';
		registeredRuntimes = [pythonRuntime1, pythonRuntime2, rRuntime1];

		const mockRuntimeSessionService = stubInterface<IRuntimeSessionService>({
			async startNewRuntimeSession(runtimeId: string, _name: string, _mode: LanguageRuntimeSessionMode, _notebookUri?: URI) {
				startedRuntimeIds.push(runtimeId);
				return `session-${nextSessionId++}`;
			},
			getSession(_id: string) {
				// Return a minimal session that passes the _waitForSessionReady check
				// by being already idle, and supports shutdown/state queries.
				return stubInterface<ILanguageRuntimeSession>({
					sessionId: `session-${nextSessionId - 1}`,
					runtimeMetadata: startedRuntimeIds.length > 0
						? findRuntimeById(startedRuntimeIds[startedRuntimeIds.length - 1])
						: pythonRuntime1,
					getRuntimeState() { return RuntimeState.Idle; },
					onDidChangeRuntimeState: Event.None,
					onDidCompleteStartup: Event.None,
					onDidEncounterStartupFailure: Event.None,
					onDidEndSession: Event.None,
					async shutdown(_reason: RuntimeExitReason) { /* no-op */ },
				});
			},
			getNotebookSessionForNotebookUri(_uri: URI) { return undefined; },
			getActiveSessions() { return []; },
			async shutdownNotebookSession(uri: URI) { shutdownUris.push(uri); },
			onDidStartRuntime: Event.None,
		});

		const mockLanguageRuntimeService = stubInterface<ILanguageRuntimeService>({
			get registeredRuntimes() {
				return registeredRuntimes;
			},
		});

		const mockDocModelService = stubInterface<IQuartoDocumentModelService>({
			getModel(_textModel) {
				return stubInterface<IQuartoDocumentModel>({ primaryLanguage, cells: [] });
			},
		});

		const mockEditorService = stubInterface<IEditorService>({
			findEditors(_uri) {
				return [stubInterface<IEditorIdentifier>({
					editor: stubInterface<EditorInput>({
						resolve: async () => ({
							textEditorModel: { uri: docUri, getLanguageId: () => 'quarto' },
							dispose() { },
						}),
					}),
				})];
			},
			// Backs the synchronous language lookup used by
			// getPreferredRuntimeForDocument: a single visible editor whose
			// model resolves to the tracked document URI.
			get visibleTextEditorControls() {
				return [{
					getModel() { return { uri: docUri }; },
				}] as unknown as IEditorService['visibleTextEditorControls'];
			},
			onDidCloseEditor: Event.None as Event<IEditorCloseEvent>,
		});

		const mockCacheService = stubInterface<IQuartoOutputCacheService>({});

		kernelManager = disposables.add(new QuartoKernelManager(
			mockRuntimeSessionService,
			runtimeStartupService,
			mockLanguageRuntimeService,
			mockDocModelService,
			mockEditorService,
			new NullLogService(),
			stubInterface<INotificationService>({ warn: vi.fn(), info: vi.fn(), notify: vi.fn() }),
			new TestConfigurationService(),
			storageService,
			mockCacheService,
		));
	});

	it('ensureKernelForDocument uses preferred runtime by default', async () => {
		await kernelManager.ensureKernelForDocument(docUri);
		expect(startedRuntimeIds).toEqual(['python-3.11']);
	});

	it('changeKernelForDocument shuts down old session and starts new runtime', async () => {
		await kernelManager.ensureKernelForDocument(docUri);
		startedRuntimeIds.length = 0;

		await kernelManager.changeKernelForDocument(docUri, pythonRuntime2.runtimeId);

		expect(shutdownUris.length).toBe(1);
		expect(shutdownUris[0].toString()).toBe(docUri.toString());
		expect(startedRuntimeIds).toEqual(['python-3.12']);
	});

	it('persisted binding is used on next ensureKernelForDocument', async () => {
		// Change to runtime2, which persists the choice
		await kernelManager.ensureKernelForDocument(docUri);
		await kernelManager.changeKernelForDocument(docUri, pythonRuntime2.runtimeId);
		startedRuntimeIds.length = 0;
		shutdownUris.length = 0;

		// Simulate document close + reopen: shut down then ensure again
		await kernelManager.shutdownKernelForDocument(docUri);
		await kernelManager.ensureKernelForDocument(docUri);

		// Should start runtime2, not the preferred runtime1
		expect(startedRuntimeIds).toEqual(['python-3.12']);
	});

	it('persisted binding survives new manager instance (storage round-trip)', async () => {
		await kernelManager.ensureKernelForDocument(docUri);
		await kernelManager.changeKernelForDocument(docUri, pythonRuntime2.runtimeId);

		// Create a fresh manager using the same storage
		startedRuntimeIds.length = 0;

		const mockRuntimeSessionService2 = stubInterface<IRuntimeSessionService>({
			async startNewRuntimeSession(runtimeId: string) {
				startedRuntimeIds.push(runtimeId);
				return `session-${nextSessionId++}`;
			},
			getSession() {
				return stubInterface<ILanguageRuntimeSession>({
					sessionId: `session-${nextSessionId - 1}`,
					runtimeMetadata: pythonRuntime2,
					getRuntimeState() { return RuntimeState.Idle; },
					onDidChangeRuntimeState: Event.None,
					onDidCompleteStartup: Event.None,
					onDidEncounterStartupFailure: Event.None,
					onDidEndSession: Event.None,
					async shutdown() { },
				});
			},
			getNotebookSessionForNotebookUri() { return undefined; },
			getActiveSessions() { return []; },
			async shutdownNotebookSession() { },
			onDidStartRuntime: Event.None,
		});

		const km2 = disposables.add(new QuartoKernelManager(
			mockRuntimeSessionService2,
			runtimeStartupService,
			stubInterface<ILanguageRuntimeService>({ get registeredRuntimes() { return [pythonRuntime1, pythonRuntime2]; } }),
			stubInterface<IQuartoDocumentModelService>({ getModel() { return stubInterface<IQuartoDocumentModel>({ primaryLanguage: 'python', cells: [] }); } }),
			stubInterface<IEditorService>({
				findEditors() {
					return [stubInterface<IEditorIdentifier>({
						editor: stubInterface<EditorInput>({
							resolve: async () => ({
								textEditorModel: { uri: docUri, getLanguageId: () => 'quarto' },
								dispose() { },
							}),
						}),
					})];
				},
				onDidCloseEditor: Event.None as Event<IEditorCloseEvent>,
			}),
			new NullLogService(),
			stubInterface<INotificationService>({ warn: vi.fn(), info: vi.fn(), notify: vi.fn() }),
			new TestConfigurationService(),
			storageService, // same storage
			stubInterface<IQuartoOutputCacheService>({}),
		));

		await km2.ensureKernelForDocument(docUri);
		expect(startedRuntimeIds).toEqual(['python-3.12']);
	});

	it('persisted binding is cleared when document language changes', async () => {
		// Start with Python and persist a binding to python-3.12
		await kernelManager.ensureKernelForDocument(docUri);
		await kernelManager.changeKernelForDocument(docUri, pythonRuntime2.runtimeId);
		startedRuntimeIds.length = 0;
		shutdownUris.length = 0;

		// Simulate: document is closed, YAML changed to R, reopened
		await kernelManager.shutdownKernelForDocument(docUri);
		primaryLanguage = 'r';
		await kernelManager.ensureKernelForDocument(docUri);

		// Should start the R runtime, not the stale Python binding
		expect(startedRuntimeIds).toEqual(['r-4.4']);
	});

	it('getPreferredRuntimeForDocument returns the preferred runtime when nothing has started', () => {
		// No session, no persisted binding: the interpreter that would start is
		// the preferred runtime for the document's language.
		expect(kernelManager.getPreferredRuntimeForDocument(docUri)).toBe(pythonRuntime1);
	});

	it('getPreferredRuntimeForDocument reports the running runtime once a kernel is started', async () => {
		await kernelManager.changeKernelForDocument(docUri, pythonRuntime2.runtimeId);
		// A kernel is running, so the badge should name that runtime rather than
		// the default preferred one.
		expect(kernelManager.getPreferredRuntimeForDocument(docUri)).toBe(pythonRuntime2);
	});

	it('getPreferredRuntimeForDocument returns undefined when the language cannot be determined', () => {
		// A URI with no matching visible editor yields no language, so there is
		// no interpreter to name.
		expect(kernelManager.getPreferredRuntimeForDocument(URI.file('/test/other.qmd'))).toBeUndefined();
	});

	it('ensureKernelForDocument waits for an adopted starting session to become ready', async () => {
		// A session that is restoring after a window reload: present in the
		// runtime session service but still Starting, not yet Ready. Returning
		// it before it is ready lets callers execute into a session that drops
		// the request (the inline-output-on-reload flake).
		const stateEmitter = disposables.add(new Emitter<RuntimeState>());
		let sessionState = RuntimeState.Starting;
		const restoringSession = stubInterface<INotebookLanguageRuntimeSession>({
			sessionId: 'restoring-session',
			runtimeMetadata: pythonRuntime1,
			getRuntimeState() { return sessionState; },
			onDidChangeRuntimeState: stateEmitter.event,
			onDidCompleteStartup: Event.None,
			onDidEncounterStartupFailure: Event.None,
			onDidEndSession: Event.None,
			async shutdown() { },
		});

		const sessionService = stubInterface<IRuntimeSessionService>({
			async startNewRuntimeSession(runtimeId: string) {
				startedRuntimeIds.push(runtimeId);
				return `session-${nextSessionId++}`;
			},
			getNotebookSessionForNotebookUri(_uri: URI) { return restoringSession; },
			getActiveSessions() { return []; },
			async shutdownNotebookSession() { },
			onDidStartRuntime: Event.None,
		});

		const km = disposables.add(new QuartoKernelManager(
			sessionService,
			runtimeStartupService,
			stubInterface<ILanguageRuntimeService>({ get registeredRuntimes() { return registeredRuntimes; } }),
			stubInterface<IQuartoDocumentModelService>({ getModel() { return stubInterface<IQuartoDocumentModel>({ primaryLanguage: 'python', cells: [] }); } }),
			stubInterface<IEditorService>({
				findEditors() { return []; },
				get visibleTextEditorControls() { return [] as unknown as IEditorService['visibleTextEditorControls']; },
				onDidCloseEditor: Event.None as Event<IEditorCloseEvent>,
			}),
			new NullLogService(),
			stubInterface<INotificationService>({ warn: vi.fn(), info: vi.fn(), notify: vi.fn() }),
			new TestConfigurationService(),
			storageService,
			stubInterface<IQuartoOutputCacheService>({}),
		));

		let resolved = false;
		const ensurePromise = km.ensureKernelForDocument(docUri).then(session => {
			resolved = true;
			return session;
		});

		// Let the async adopt path run. It must not resolve while the adopted
		// session is still Starting.
		await new Promise(resolve => setTimeout(resolve, 0));
		expect(resolved).toBe(false);

		// The session finishes starting.
		sessionState = RuntimeState.Ready;
		stateEmitter.fire(RuntimeState.Ready);

		const session = await ensurePromise;
		expect(resolved).toBe(true);
		expect(session).toBe(restoringSession);
		// No new session should have been started; the existing one was adopted.
		expect(startedRuntimeIds).toEqual([]);
	});

	it('changeKernelForDocument fires state change events', async () => {
		await kernelManager.ensureKernelForDocument(docUri);

		const states: QuartoKernelState[] = [];
		disposables.add(kernelManager.onDidChangeKernelState(e => {
			if (e.documentUri.toString() === docUri.toString()) {
				states.push(e.newState);
			}
		}));

		await kernelManager.changeKernelForDocument(docUri, pythonRuntime2.runtimeId);

		// Should see shutdown states then startup states
		expect(states).toContain(QuartoKernelState.None);
		expect(states).toContain(QuartoKernelState.Starting);
		expect(states).toContain(QuartoKernelState.Ready);
	});
});
