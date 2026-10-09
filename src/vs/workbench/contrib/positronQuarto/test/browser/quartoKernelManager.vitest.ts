/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { timeout } from '../../../../../base/common/async.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { InMemoryStorageService, StorageScope } from '../../../../../platform/storage/common/storage.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { TestRuntimeStartupService } from '../../../../services/runtimeStartup/test/common/testRuntimeStartupService.js';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService, LanguageRuntimeSessionMode, LanguageRuntimeStartupBehavior, LanguageRuntimeSessionLocation, RuntimeExitReason, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, INotebookLanguageRuntimeSession, IRuntimeSessionService, IStartNewRuntimeSessionOptions, IUpdateNotebookSessionUriOptions, RuntimeStartMode, IRuntimeSessionStartReason, SessionStartReasonId } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { ActiveRuntimeSession } from '../../../../services/runtimeSession/common/activeRuntimeSession.js';
import { IQuartoDocumentModel } from '../../common/quartoTypes.js';
import { IQuartoDocumentModelService } from '../../browser/quartoDocumentModelService.js';
import { IQuartoOutputCacheService } from '../../common/quartoExecutionTypes.js';
import { QuartoKernelManager, QuartoKernelState } from '../../browser/quartoKernelManager.js';
import { IEditorIdentifier, IEditorCloseEvent } from '../../../../common/editor.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { IUntitledTextEditorService, IUntitledTextEditorModelSaveEvent } from '../../../../services/untitled/common/untitledTextEditorService.js';

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
	let startReasons: IRuntimeSessionStartReason[];
	let startOptions: (IStartNewRuntimeSessionOptions | undefined)[];
	let shutdownUris: URI[];
	let nextSessionId: number;
	let lastStartedNotebookUri: URI | undefined;
	let untitledSaveEmitter: Emitter<IUntitledTextEditorModelSaveEvent>;
	let uriUpdates: { oldUri: string; newUri: string; quartoNotebookUri: string | undefined }[];
	let sessionState: RuntimeState;
	let editorDocUri: URI;
	let activeSessions: ActiveRuntimeSession[];
	let editorlessUris: URI[];
	let notebookSessions: Map<string, INotebookLanguageRuntimeSession>;
	let closeEditorEmitter: Emitter<IEditorCloseEvent>;
	let startRuntimeEmitter: Emitter<ILanguageRuntimeSession>;
	let sessionStateEmitter: Emitter<RuntimeState>;
	let announceStart: boolean;
	let announcedSessions: Map<string, ILanguageRuntimeSession>;

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
		startReasons = [];
		startOptions = [];
		shutdownUris = [];
		nextSessionId = 0;
		lastStartedNotebookUri = undefined;
		untitledSaveEmitter = disposables.add(new Emitter());
		uriUpdates = [];
		sessionState = RuntimeState.Idle;
		editorDocUri = docUri;
		activeSessions = [];
		editorlessUris = [];
		notebookSessions = new Map();
		closeEditorEmitter = disposables.add(new Emitter());
		startRuntimeEmitter = disposables.add(new Emitter());
		sessionStateEmitter = disposables.add(new Emitter());
		announceStart = false;
		announcedSessions = new Map();
		primaryLanguage = 'python';
		registeredRuntimes = [pythonRuntime1, pythonRuntime2, rRuntime1];

		// Return a minimal session that passes the _waitForSessionReady check
		// by being already idle, and supports shutdown/state queries.
		function makeSession() {
			return stubInterface<ILanguageRuntimeSession>({
				sessionId: `session-${nextSessionId - 1}`,
				runtimeMetadata: startedRuntimeIds.length > 0
					? findRuntimeById(startedRuntimeIds[startedRuntimeIds.length - 1])
					: pythonRuntime1,
				metadata: stubInterface<ILanguageRuntimeSession['metadata']>({ notebookUri: lastStartedNotebookUri, sessionMode: LanguageRuntimeSessionMode.Notebook, quartoNotebookUri: startOptions[startOptions.length - 1]?.quartoNotebookUri }),
				getRuntimeState() { return sessionState; },
				onDidChangeRuntimeState: sessionStateEmitter.event,
				onDidCompleteStartup: Event.None,
				onDidEncounterStartupFailure: Event.None,
				onDidEndSession: Event.None,
				async shutdown(_reason: RuntimeExitReason) { /* no-op */ },
			});
		}

		const mockRuntimeSessionService = stubInterface<IRuntimeSessionService>({
			async startNewRuntimeSession(runtimeId: string, _name: string, _mode: LanguageRuntimeSessionMode, notebookUri: URI | undefined, startReason: IRuntimeSessionStartReason, _startMode?: RuntimeStartMode, _activate?: boolean, options?: IStartNewRuntimeSessionOptions) {
				startedRuntimeIds.push(runtimeId);
				lastStartedNotebookUri = notebookUri;
				startReasons.push(startReason);
				startOptions.push(options);
				const sessionId = `session-${nextSessionId++}`;
				// The real service registers and announces a session before
				// it returns the session's ID.
				if (announceStart && notebookUri) {
					const session = makeSession();
					announcedSessions.set(sessionId, session);
					notebookSessions.set(notebookUri.toString(), session as INotebookLanguageRuntimeSession);
					startRuntimeEmitter.fire(session);
				}
				return sessionId;
			},
			getSession(id: string) {
				return announcedSessions.get(id) ?? makeSession();
			},
			async updateNotebookSessionUri(oldUri: URI, newUri: URI, options?: IUpdateNotebookSessionUriOptions) {
				uriUpdates.push({ oldUri: oldUri.toString(), newUri: newUri.toString(), quartoNotebookUri: options?.quartoNotebookUri?.toString() });
				return 'session-0';
			},
			getNotebookSessionForNotebookUri(uri: URI) { return notebookSessions.get(uri.toString()); },
			getActiveSessions() { return activeSessions; },
			async shutdownNotebookSession(uri: URI) { shutdownUris.push(uri); },
			onDidStartRuntime: startRuntimeEmitter.event,
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
			findEditors(uri) {
				if (editorlessUris.some(editorless => editorless.toString() === uri.toString())) {
					return [];
				}
				return [stubInterface<IEditorIdentifier>({
					editor: stubInterface<EditorInput>({
						resolve: async () => ({
							textEditorModel: { uri: editorDocUri, getLanguageId: () => 'quarto' },
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
					getModel() { return { uri: editorDocUri }; },
				}] as unknown as IEditorService['visibleTextEditorControls'];
			},
			onDidCloseEditor: closeEditorEmitter.event,
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
			stubInterface<IUntitledTextEditorService>({ onDidSave: untitledSaveEmitter.event }),
		));
	});

	it('ensureKernelForDocument uses preferred runtime by default', async () => {
		await kernelManager.ensureKernelForDocument(docUri);
		expect(startedRuntimeIds).toEqual(['python-3.11']);
	});

	it('ensureKernelForDocument records the inline output start reason', async () => {
		await kernelManager.ensureKernelForDocument(docUri);
		expect(startReasons).toEqual([{ id: SessionStartReasonId.QuartoInlineOutput }]);
	});

	it('tells a new session the URI of its document\'s hidden notebook', async () => {
		await kernelManager.ensureKernelForDocument(docUri);

		expect(startOptions.map(options => options?.quartoNotebookUri?.toString()))
			.toEqual(['quarto-cells:/test/doc.qmd.ipynb']);
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
			stubInterface<IUntitledTextEditorService>({ onDidSave: Event.None }),
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

	describe('Save As from an untitled document', () => {
		const untitledUri = URI.from({ scheme: 'untitled', path: 'Untitled-1' });
		const savedUri = URI.file('/test/saved.qmd');

		beforeEach(() => {
			editorDocUri = untitledUri;
		});

		it('moves the kernel to the saved document and points the session at its hidden notebook', async () => {
			await kernelManager.ensureKernelForDocument(untitledUri);
			const states: string[] = [];
			disposables.add(kernelManager.onDidChangeKernelState(e => states.push(`${e.documentUri.toString()}:${e.newState}`)));

			untitledSaveEmitter.fire({ source: untitledUri, target: savedUri });

			expect({
				untitledState: kernelManager.getKernelState(untitledUri),
				savedState: kernelManager.getKernelState(savedUri),
				uriUpdates,
				states,
			}).toEqual({
				untitledState: QuartoKernelState.None,
				savedState: QuartoKernelState.Ready,
				uriUpdates: [{ oldUri: untitledUri.toString(), newUri: savedUri.toString(), quartoNotebookUri: 'quarto-cells:/test/saved.qmd.ipynb' }],
				states: [`${untitledUri.toString()}:${QuartoKernelState.None}`, `${savedUri.toString()}:${QuartoKernelState.Ready}`],
			});
		});

		it('carries the persisted runtime choice to the saved document', async () => {
			await kernelManager.changeKernelForDocument(untitledUri, pythonRuntime2.runtimeId);

			untitledSaveEmitter.fire({ source: untitledUri, target: savedUri });

			const persisted = JSON.parse(storageService.get('positronQuarto.kernelBindings', StorageScope.WORKSPACE, '{}'));
			expect(persisted).toEqual({ [savedUri.toString()]: pythonRuntime2.runtimeId });
		});

		it('does not follow a save under a non-Quarto name', async () => {
			await kernelManager.ensureKernelForDocument(untitledUri);

			untitledSaveEmitter.fire({ source: untitledUri, target: URI.file('/test/saved.R') });

			expect({ uriUpdates, untitledState: kernelManager.getKernelState(untitledUri) })
				.toEqual({ uriUpdates: [], untitledState: QuartoKernelState.Ready });
		});

		it('does not take over a saved document that already has a kernel', async () => {
			editorDocUri = savedUri;
			await kernelManager.ensureKernelForDocument(savedUri);
			editorDocUri = untitledUri;
			await kernelManager.ensureKernelForDocument(untitledUri);

			untitledSaveEmitter.fire({ source: untitledUri, target: savedUri });

			expect({ uriUpdates, untitledState: kernelManager.getKernelState(untitledUri), savedState: kernelManager.getKernelState(savedUri) })
				.toEqual({ uriUpdates: [], untitledState: QuartoKernelState.Ready, savedState: QuartoKernelState.Ready });
		});

		it('shuts the kernel down when the untitled tab is closed with Save and the saved file is not opened', async () => {
			await kernelManager.ensureKernelForDocument(untitledUri);
			untitledSaveEmitter.fire({ source: untitledUri, target: savedUri });
			editorlessUris = [untitledUri, savedUri];

			closeEditorEmitter.fire(stubInterface<IEditorCloseEvent>({ editor: stubInterface<EditorInput>({ resource: untitledUri }) }));
			await timeout(150);

			expect({ shutdownUris: shutdownUris.map(uri => uri.toString()), savedState: kernelManager.getKernelState(savedUri) })
				.toEqual({ shutdownUris: [savedUri.toString()], savedState: QuartoKernelState.None });
		});

		it('keeps the kernel when the saved file replaces the untitled tab', async () => {
			await kernelManager.ensureKernelForDocument(untitledUri);
			untitledSaveEmitter.fire({ source: untitledUri, target: savedUri });
			editorlessUris = [untitledUri];

			closeEditorEmitter.fire(stubInterface<IEditorCloseEvent>({ editor: stubInterface<EditorInput>({ resource: untitledUri }) }));
			await timeout(150);

			expect({ shutdownUris, savedState: kernelManager.getKernelState(savedUri) })
				.toEqual({ shutdownUris: [], savedState: QuartoKernelState.Ready });
		});

		it('reports no state for the untitled document once its kernel has moved', async () => {
			announceStart = true;
			await kernelManager.ensureKernelForDocument(untitledUri);
			untitledSaveEmitter.fire({ source: untitledUri, target: savedUri });
			const states: string[] = [];
			disposables.add(kernelManager.onDidChangeKernelState(e => states.push(`${e.documentUri.toString()}:${e.newState}`)));

			sessionStateEmitter.fire(RuntimeState.Busy);

			expect(states).toEqual([`${savedUri.toString()}:${QuartoKernelState.Busy}`]);
		});

		it('does nothing for a document with no kernel', () => {
			untitledSaveEmitter.fire({ source: untitledUri, target: savedUri });

			expect(uriUpdates).toEqual([]);
		});

		it('leaves a kernel that is still starting where it is', async () => {
			sessionState = RuntimeState.Starting;
			const ensured = kernelManager.ensureKernelForDocument(untitledUri);
			ensured.catch(() => { });
			await vi.waitFor(() => expect(kernelManager.getKernelState(untitledUri)).toBe(QuartoKernelState.Starting));

			untitledSaveEmitter.fire({ source: untitledUri, target: savedUri });

			expect({ uriUpdates, savedState: kernelManager.getKernelState(savedUri) })
				.toEqual({ uriUpdates: [], savedState: QuartoKernelState.None });
		});
	});

	it('recovers an untitled session whose document was renumbered after a reload', async () => {
		const oldUri = URI.from({ scheme: 'untitled', path: 'Untitled-1' });
		const newUri = URI.from({ scheme: 'untitled', path: 'Untitled-2' });
		editorDocUri = newUri;
		editorlessUris = [oldUri];
		activeSessions = [stubInterface<ActiveRuntimeSession>({
			session: stubInterface<ILanguageRuntimeSession>({
				sessionId: 'restored',
				metadata: stubInterface<ILanguageRuntimeSession['metadata']>({ notebookUri: oldUri, sessionMode: LanguageRuntimeSessionMode.Notebook, quartoNotebookUri: URI.from({ scheme: 'quarto-cells', path: 'Untitled-1.qmd.ipynb' }) }),
				runtimeMetadata: pythonRuntime1,
				getRuntimeState: () => RuntimeState.Idle,
				onDidChangeRuntimeState: Event.None,
				onDidEndSession: Event.None,
				async shutdown(_reason: RuntimeExitReason) { /* no-op */ },
			}),
		})];

		const session = await kernelManager.ensureKernelForDocument(newUri);

		expect({ sessionId: session?.sessionId, startedRuntimeIds, uriUpdates }).toEqual({
			sessionId: 'restored',
			startedRuntimeIds: [],
			uriUpdates: [{ oldUri: oldUri.toString(), newUri: newUri.toString(), quartoNotebookUri: 'quarto-cells:Untitled-2.qmd.ipynb' }],
		});
	});

	describe('untitled sessions that belong to another document', () => {
		const firstUri = URI.from({ scheme: 'untitled', path: 'Untitled-1' });
		const secondUri = URI.from({ scheme: 'untitled', path: 'Untitled-2' });

		function restoredSession(notebookUri: URI): INotebookLanguageRuntimeSession {
			return stubInterface<INotebookLanguageRuntimeSession>({
				sessionId: 'restored',
				metadata: stubInterface<INotebookLanguageRuntimeSession['metadata']>({ notebookUri, sessionMode: LanguageRuntimeSessionMode.Notebook, quartoNotebookUri: URI.from({ scheme: 'quarto-cells', path: `${notebookUri.path}.qmd.ipynb` }) }),
				runtimeMetadata: pythonRuntime1,
				getRuntimeState: () => RuntimeState.Idle,
				onDidChangeRuntimeState: Event.None,
				onDidEndSession: Event.None,
				async shutdown(_reason: RuntimeExitReason) { /* no-op */ },
			});
		}

		it('does not take a second untitled document\'s kernel from the first', async () => {
			editorDocUri = firstUri;
			const first = await kernelManager.ensureKernelForDocument(firstUri);
			activeSessions = [stubInterface<ActiveRuntimeSession>({ session: first! })];
			editorDocUri = secondUri;

			await kernelManager.ensureKernelForDocument(secondUri);

			expect({ startedRuntimeIds, uriUpdates }).toEqual({ startedRuntimeIds: ['python-3.11', 'python-3.11'], uriUpdates: [] });
		});

		it('does not recover an untitled session of another language', async () => {
			editorDocUri = secondUri;
			editorlessUris = [firstUri];
			primaryLanguage = 'r';
			activeSessions = [stubInterface<ActiveRuntimeSession>({ session: restoredSession(firstUri) })];

			await kernelManager.ensureKernelForDocument(secondUri);

			expect({ startedRuntimeIds, uriUpdates }).toEqual({ startedRuntimeIds: ['r-4.4'], uriUpdates: [] });
		});

		it('does not adopt a started untitled session that no editor shows', async () => {
			editorlessUris = [firstUri];
			const session = restoredSession(firstUri);
			notebookSessions.set(firstUri.toString(), session);
			const states: string[] = [];
			disposables.add(kernelManager.onDidChangeKernelState(e => states.push(`${e.documentUri.toString()}:${e.newState}`)));

			startRuntimeEmitter.fire(session);
			await timeout(0);

			expect(states).toEqual([]);
		});
	});
});
