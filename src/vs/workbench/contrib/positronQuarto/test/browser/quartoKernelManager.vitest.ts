/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { Event } from '../../../../../base/common/event.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { TestRuntimeStartupService } from '../../../../services/runtimeStartup/test/common/testRuntimeStartupService.js';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService, LanguageRuntimeSessionMode, LanguageRuntimeStartupBehavior, LanguageRuntimeSessionLocation, RuntimeExitReason, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IQuartoDocumentModel } from '../../common/quartoTypes.js';
import { IQuartoDocumentModelService } from '../../browser/quartoDocumentModelService.js';
import { IQuartoOutputCacheService } from '../../common/quartoExecutionTypes.js';
import { QuartoKernelManager, QuartoKernelState } from '../../browser/quartoKernelManager.js';
import { IEditorIdentifier, IEditorCloseEvent } from '../../../../common/editor.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { POSITRON_QUARTO_EXECUTION_USE_SHARED_SESSION_KEY } from '../../common/positronQuartoConfig.js';

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
const docUri2 = URI.file('/test/doc-two.qmd');
const docUri3 = URI.file('/test/doc-three.qmd');

describe('QuartoKernelManager', () => {
	const disposables = ensureNoLeakedDisposables();

	let kernelManager: QuartoKernelManager;
	let runtimeStartupService: TestRuntimeStartupService;
	let storageService: InMemoryStorageService;
	let configurationService: TestConfigurationService;

	// Track calls to startNewRuntimeSession
	let startedRuntimeIds: string[];
	let sessionNames: string[];
	let shutdownUris: URI[];
	let nextSessionId: number;
	let sessionsById: Map<string, ILanguageRuntimeSession>;
	let notebookSessionsByUri: Map<string, ILanguageRuntimeSession>;

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
		configurationService = new TestConfigurationService();

		startedRuntimeIds = [];
		sessionNames = [];
		shutdownUris = [];
		nextSessionId = 0;
		sessionsById = new Map();
		notebookSessionsByUri = new Map();
		primaryLanguage = 'python';
		registeredRuntimes = [pythonRuntime1, pythonRuntime2, rRuntime1];

		const mockRuntimeSessionService = stubInterface<IRuntimeSessionService>({
			async startNewRuntimeSession(runtimeId: string, name: string, mode: LanguageRuntimeSessionMode, notebookUri?: URI) {
				startedRuntimeIds.push(runtimeId);
				sessionNames.push(name);

				const sessionId = `session-${nextSessionId++}`;
				const metadata = {
					sessionId,
					sessionMode: mode,
					notebookUri,
					createdTimestamp: Date.now(),
					startReason: 'test',
				};
				const runtime = findRuntimeById(runtimeId);
				const session = stubInterface<ILanguageRuntimeSession>({
					sessionId,
					metadata,
					runtimeMetadata: runtime,
					getRuntimeState() { return RuntimeState.Idle; },
					onDidChangeRuntimeState: Event.None,
					onDidCompleteStartup: Event.None,
					onDidEncounterStartupFailure: Event.None,
					onDidEndSession: Event.None,
					async shutdown(_reason?: RuntimeExitReason) {
						sessionsById.delete(sessionId);
						if (notebookUri) {
							notebookSessionsByUri.delete(notebookUri.toString());
						}
					},
					interrupt() { /* no-op */ },
				});
				sessionsById.set(sessionId, session);
				if (notebookUri) {
					notebookSessionsByUri.set(notebookUri.toString(), session);
				}
				return sessionId;
			},
			getSession(id: string) {
				return sessionsById.get(id);
			},
			getNotebookSessionForNotebookUri(uri: URI) {
				return notebookSessionsByUri.get(uri.toString());
			},
			getActiveSessions() { return []; },
			async shutdownNotebookSession(uri: URI) {
				shutdownUris.push(uri);
				const session = notebookSessionsByUri.get(uri.toString());
				if (session) {
					sessionsById.delete(session.sessionId);
					notebookSessionsByUri.delete(uri.toString());
				}
			},
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
							textEditorModel: { uri: _uri, getLanguageId: () => 'quarto' },
							dispose() { },
						}),
					}),
				})];
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
			configurationService,
			storageService,
			mockCacheService,
		));
	});

	it('ensureKernelForDocument uses preferred runtime by default', async () => {
		await kernelManager.ensureKernelForDocument(docUri);
		expect(startedRuntimeIds).toEqual(['python-3.11']);
	});

	it('keeps separate sessions for separate documents by default', async () => {
		const session1 = await kernelManager.ensureKernelForDocument(docUri);
		const session2 = await kernelManager.ensureKernelForDocument(docUri2);

		expect(session1?.sessionId).not.toBe(session2?.sessionId);
		expect(startedRuntimeIds).toEqual(['python-3.11', 'python-3.11']);
	});

	it('reuses a compatible session when shared sessions are enabled', async () => {
		await configurationService.setUserConfiguration(POSITRON_QUARTO_EXECUTION_USE_SHARED_SESSION_KEY, true);

		const session1 = await kernelManager.ensureKernelForDocument(docUri);
		const session2 = await kernelManager.ensureKernelForDocument(docUri2);

		expect(session2?.sessionId).toBe(session1?.sessionId);
		expect(startedRuntimeIds).toEqual(['python-3.11']);
		expect(sessionNames).toEqual(['Quarto: Python 3.11']);
	});

	it('does not share sessions across different runtimes', async () => {
		await configurationService.setUserConfiguration(POSITRON_QUARTO_EXECUTION_USE_SHARED_SESSION_KEY, true);

		const pythonSession = await kernelManager.ensureKernelForDocument(docUri);
		primaryLanguage = 'r';
		const rSession = await kernelManager.ensureKernelForDocument(docUri3);

		expect(rSession?.sessionId).not.toBe(pythonSession?.sessionId);
		expect(startedRuntimeIds).toEqual(['python-3.11', 'r-4.4']);
	});

	it('changing one shared document kernel does not shut down a session still used by another document', async () => {
		await configurationService.setUserConfiguration(POSITRON_QUARTO_EXECUTION_USE_SHARED_SESSION_KEY, true);

		const originalSession = await kernelManager.ensureKernelForDocument(docUri);
		const sharedSession = await kernelManager.ensureKernelForDocument(docUri2);
		expect(sharedSession?.sessionId).toBe(originalSession?.sessionId);

		await kernelManager.changeKernelForDocument(docUri2, pythonRuntime2.runtimeId);

		expect(shutdownUris).toEqual([]);
		expect(kernelManager.getSessionForDocument(docUri)?.sessionId).toBe(originalSession?.sessionId);
		expect(kernelManager.getSessionForDocument(docUri2)?.sessionId).not.toBe(originalSession?.sessionId);
		expect(startedRuntimeIds).toEqual(['python-3.11', 'python-3.12']);
	});

	it('shutdown of a shared kernel clears all attached documents', async () => {
		await configurationService.setUserConfiguration(POSITRON_QUARTO_EXECUTION_USE_SHARED_SESSION_KEY, true);

		const session1 = await kernelManager.ensureKernelForDocument(docUri);
		const session2 = await kernelManager.ensureKernelForDocument(docUri2);
		expect(session2?.sessionId).toBe(session1?.sessionId);

		await kernelManager.shutdownKernelForDocument(docUri2);

		expect(shutdownUris.map(uri => uri.toString())).toEqual([docUri.toString()]);
		expect(kernelManager.getKernelState(docUri)).toBe(QuartoKernelState.None);
		expect(kernelManager.getKernelState(docUri2)).toBe(QuartoKernelState.None);
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
