/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable local/code-no-dangerous-type-assertions */

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { Event } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { TestRuntimeStartupService } from '../../../../services/runtimeStartup/test/common/testRuntimeStartupService.js';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService, LanguageRuntimeSessionMode, LanguageRuntimeStartupBehavior, LanguageRuntimeSessionLocation, RuntimeExitReason, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IQuartoDocumentModelService } from '../../browser/quartoDocumentModelService.js';
import { IQuartoOutputCacheService } from '../../common/quartoExecutionTypes.js';
import { QuartoKernelManager, QuartoKernelState } from '../../browser/quartoKernelManager.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';

function makeRuntime(id: string, languageId: string, name: string): ILanguageRuntimeMetadata {
	return {
		base64EncodedIconSvg: '',
		extensionId: { value: 'test.extension' } as ExtensionIdentifier,
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

suite('QuartoKernelManager', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

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

	setup(() => {
		runtimeStartupService = new TestRuntimeStartupService();
		runtimeStartupService.setPreferredRuntime('python', pythonRuntime1);
		runtimeStartupService.setPreferredRuntime('r', rRuntime1);

		storageService = disposables.add(new InMemoryStorageService());

		startedRuntimeIds = [];
		shutdownUris = [];
		nextSessionId = 0;
		primaryLanguage = 'python';
		registeredRuntimes = [pythonRuntime1, pythonRuntime2, rRuntime1];

		const mockRuntimeSessionService: Partial<IRuntimeSessionService> = {
			async startNewRuntimeSession(runtimeId: string, _name: string, _mode: LanguageRuntimeSessionMode, _notebookUri?: URI) {
				startedRuntimeIds.push(runtimeId);
				return `session-${nextSessionId++}`;
			},
			getSession(_id: string) {
				// Return a minimal session that passes the _waitForSessionReady check
				// by being already idle, and supports shutdown/state queries.
				return {
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
				} as any;
			},
			getNotebookSessionForNotebookUri(_uri: URI) { return undefined; },
			getActiveSessions() { return []; },
			async shutdownNotebookSession(uri: URI) { shutdownUris.push(uri); },
			onDidStartRuntime: Event.None,
		};

		const mockLanguageRuntimeService: Partial<ILanguageRuntimeService> = {
			get registeredRuntimes() {
				return registeredRuntimes;
			},
		};

		const mockDocModelService: Partial<IQuartoDocumentModelService> = {
			getModel(_textModel: any) {
				return { primaryLanguage, cells: [] } as any;
			},
		};

		const mockEditorService: Partial<IEditorService> = {
			findEditors(_uri: any) {
				return [{
					editor: {
						async resolve() {
							return {
								textEditorModel: { uri: docUri, getLanguageId: () => 'quarto' },
							};
						},
					},
				}] as any;
			},
			onDidCloseEditor: Event.None as any,
		};

		const mockCacheService: Partial<IQuartoOutputCacheService> = {};

		kernelManager = disposables.add(new QuartoKernelManager(
			mockRuntimeSessionService as IRuntimeSessionService,
			runtimeStartupService,
			mockLanguageRuntimeService as ILanguageRuntimeService,
			mockDocModelService as IQuartoDocumentModelService,
			mockEditorService as IEditorService,
			new NullLogService(),
			{ warn() { }, notify() { }, info() { } } as any,
			new TestConfigurationService() as any,
			storageService,
			mockCacheService as IQuartoOutputCacheService,
		));
	});

	test('ensureKernelForDocument uses preferred runtime by default', async () => {
		await kernelManager.ensureKernelForDocument(docUri);
		assert.deepStrictEqual(startedRuntimeIds, ['python-3.11']);
	});

	test('changeKernelForDocument shuts down old session and starts new runtime', async () => {
		await kernelManager.ensureKernelForDocument(docUri);
		startedRuntimeIds.length = 0;

		await kernelManager.changeKernelForDocument(docUri, pythonRuntime2.runtimeId);

		assert.strictEqual(shutdownUris.length, 1);
		assert.strictEqual(shutdownUris[0].toString(), docUri.toString());
		assert.deepStrictEqual(startedRuntimeIds, ['python-3.12']);
	});

	test('persisted binding is used on next ensureKernelForDocument', async () => {
		// Change to runtime2, which persists the choice
		await kernelManager.ensureKernelForDocument(docUri);
		await kernelManager.changeKernelForDocument(docUri, pythonRuntime2.runtimeId);
		startedRuntimeIds.length = 0;
		shutdownUris.length = 0;

		// Simulate document close + reopen: shut down then ensure again
		await kernelManager.shutdownKernelForDocument(docUri);
		await kernelManager.ensureKernelForDocument(docUri);

		// Should start runtime2, not the preferred runtime1
		assert.deepStrictEqual(startedRuntimeIds, ['python-3.12']);
	});

	test('persisted binding survives new manager instance (storage round-trip)', async () => {
		await kernelManager.ensureKernelForDocument(docUri);
		await kernelManager.changeKernelForDocument(docUri, pythonRuntime2.runtimeId);

		// Create a fresh manager using the same storage
		startedRuntimeIds.length = 0;

		const mockRuntimeSessionService2: Partial<IRuntimeSessionService> = {
			async startNewRuntimeSession(runtimeId: string) {
				startedRuntimeIds.push(runtimeId);
				return `session-${nextSessionId++}`;
			},
			getSession() {
				return {
					sessionId: `session-${nextSessionId - 1}`,
					runtimeMetadata: pythonRuntime2,
					getRuntimeState() { return RuntimeState.Idle; },
					onDidChangeRuntimeState: Event.None,
					onDidCompleteStartup: Event.None,
					onDidEncounterStartupFailure: Event.None,
					onDidEndSession: Event.None,
					async shutdown() { },
				} as any;
			},
			getNotebookSessionForNotebookUri() { return undefined; },
			getActiveSessions() { return []; },
			async shutdownNotebookSession() { },
			onDidStartRuntime: Event.None,
		};

		const km2 = disposables.add(new QuartoKernelManager(
			mockRuntimeSessionService2 as IRuntimeSessionService,
			runtimeStartupService,
			{ get registeredRuntimes() { return [pythonRuntime1, pythonRuntime2]; } } as ILanguageRuntimeService,
			{ getModel() { return { primaryLanguage: 'python', cells: [] }; } } as any,
			{ findEditors() { return [{ editor: { async resolve() { return { textEditorModel: { uri: docUri, getLanguageId: () => 'quarto' } }; } } }]; }, onDidCloseEditor: Event.None } as any,
			new NullLogService(),
			{ warn() { }, notify() { }, info() { } } as any,
			new TestConfigurationService() as any,
			storageService, // same storage
			{} as IQuartoOutputCacheService,
		));

		await km2.ensureKernelForDocument(docUri);
		assert.deepStrictEqual(startedRuntimeIds, ['python-3.12']);
	});

	test('persisted binding is cleared when document language changes', async () => {
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
		assert.deepStrictEqual(startedRuntimeIds, ['r-4.4']);
	});

	test('changeKernelForDocument fires state change events', async () => {
		await kernelManager.ensureKernelForDocument(docUri);

		const states: QuartoKernelState[] = [];
		disposables.add(kernelManager.onDidChangeKernelState(e => {
			if (e.documentUri.toString() === docUri.toString()) {
				states.push(e.newState);
			}
		}));

		await kernelManager.changeKernelForDocument(docUri, pythonRuntime2.runtimeId);

		// Should see shutdown states then startup states
		assert.ok(states.includes(QuartoKernelState.None), 'should transition through None on shutdown');
		assert.ok(states.includes(QuartoKernelState.Starting), 'should transition through Starting');
		assert.ok(states.includes(QuartoKernelState.Ready), 'should reach Ready');
	});
});
