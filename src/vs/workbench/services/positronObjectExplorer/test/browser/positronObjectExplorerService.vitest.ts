/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Emitter } from '../../../../../base/common/event.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { FileChangesEvent, FileChangeType, IFileContent, IFileService, IFileSystemWatcher } from '../../../../../platform/files/common/files.js';
import { IEditorService } from '../../../editor/common/editorService.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { RuntimeClientState, RuntimeClientType } from '../../../languageRuntime/common/languageRuntimeClientInstance.js';
import { startTestLanguageRuntimeSession } from '../../../runtimeSession/test/common/testRuntimeSessionService.js';
import { PositronObjectExplorerService } from '../../browser/positronObjectExplorerService.js';
import { PositronObjectExplorerUri } from '../../common/positronObjectExplorerUri.js';
import { TestRuntimeClientInstance } from '../../../languageRuntime/test/common/testRuntimeClientInstance.js';

describe('PositronObjectExplorerService', () => {
	const openEditor = vi.fn(async () => ({}));
	const ctx = createTestContainer()
		.withWorkbenchServices()
		.stub(IEditorService, { openEditor })
		.build();

	/**
	 * Starts a session, then creates the service, which attaches to it. Every client the session
	 * creates answers RPCs with the state of an object titled 'd'.
	 */
	async function setup() {
		const session = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables);

		// Registered before the service's listener, so clients can answer the RPCs it sends.
		ctx.disposables.add(session.onDidCreateClientInstance(e => {
			(e.client as TestRuntimeClientInstance).rpcHandler = async () =>
				({ data: { result: { title: 'd', connected: true } }, buffers: [] });
		}));

		const service = ctx.disposables.add(ctx.instantiationService.createInstance(PositronObjectExplorerService));
		const openComm = (data: Record<string, unknown>) => session.createClient(RuntimeClientType.ObjectExplorer, data);
		return { session, service, openComm };
	}

	it('registers an instance and opens an editor when a runtime opens an object explorer comm', async () => {
		const { session, service, openComm } = await setup();

		const client = await openComm({ title: 'd', variable_path: ['d'] });

		const instance = service.getInstance(client.getClientId());
		expect(instance).toBeDefined();
		expect(service.getInstanceForVariablePath(session.sessionId, ['d'])).toBe(instance);
		expect(openEditor).toHaveBeenCalledWith({
			resource: PositronObjectExplorerUri.generate(client.getClientId()),
			options: { pinned: true }
		});
	});

	it('ignores other client types', async () => {
		const { session, service } = await setup();

		const client = await session.createClient(RuntimeClientType.DataExplorer, {});

		expect(service.getInstance(client.getClientId())).toBeUndefined();
	});

	it('opens no editor for inline object explorers, and leaves them open when an editor closes', async () => {
		const { service, openComm } = await setup();

		const client = await openComm({ title: 'd', inline_only: true });
		service.closeInstance(client.getClientId());

		expect(service.getInstance(client.getClientId())?.isInline).toBe(true);
		expect(openEditor).not.toHaveBeenCalled();
	});

	it('forgets variable bindings when the comm closes, and disposes the instance when its editor closes', async () => {
		const { service, openComm } = await setup();
		const client = await openComm({ title: 'd' });
		service.setInstanceForVar(client.getClientId(), 'var-1');
		expect(service.getInstanceForVar('var-1')).toBeDefined();

		client.setClientState(RuntimeClientState.Closed);
		expect(service.getInstanceForVar('var-1')).toBeUndefined();
		expect(service.getInstance(client.getClientId())).toBeDefined();

		service.closeInstance(client.getClientId());
		expect(service.getInstance(client.getClientId())).toBeUndefined();
	});

	it('resolves getInstanceAsync when the instance registers later', async () => {
		const { service, session } = await setup();
		const id = 'later-comm';

		const pending = service.getInstanceAsync(id, 1000);
		await session.createClient(RuntimeClientType.ObjectExplorer, { title: 'd' }, undefined, id);

		expect(await pending).toBe(service.getInstance(id));
		expect(await service.getInstanceAsync('never', 10)).toBeUndefined();
	});
});

describe('PositronObjectExplorerService JSON files', () => {
	const fileUri = URI.file('/data/config.json');
	let contents = '';
	const readFile = vi.fn(async () => stubInterface<IFileContent>({ value: VSBuffer.fromString(contents) }));
	const onDidChange = new Emitter<FileChangesEvent>();
	const ctx = createTestContainer()
		.withWorkbenchServices()
		.stub(IEditorService, { openEditor: vi.fn(async () => ({})) })
		.stub(INotificationService, { error: vi.fn() })
		.stub(IFileService, {
			readFile,
			createWatcher: () => stubInterface<IFileSystemWatcher>({ onDidChange: onDidChange.event, dispose: () => { } }),
		})
		.build();

	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	function createService() {
		return ctx.disposables.add(ctx.instantiationService.createInstance(PositronObjectExplorerService));
	}

	async function childNames(service: PositronObjectExplorerService, identifier: string) {
		const result = await service.getInstance(identifier)!.client.getChildren([], 0, 100);
		return result.children.map(child => child.display_name);
	}

	function fileChanged(type: FileChangeType) {
		onDidChange.fire(new FileChangesEvent([{ resource: fileUri, type }], true));
	}

	it('reads a file into a file-backed instance once', async () => {
		contents = '{"a": 1}';
		const service = createService();

		const identifier = await service.loadJsonFile(fileUri);
		const again = await service.loadJsonFile(fileUri);

		expect([identifier, again, readFile.mock.calls.length]).toEqual([`json:${fileUri.toString()}`, identifier, 1]);
		expect(service.getInstance(identifier)?.fileUri?.toString()).toBe(fileUri.toString());
		expect(await childNames(service, identifier)).toEqual(['a']);
	});

	it('reloads when the file changes, keeping the last good value while it does not parse', async () => {
		contents = '{"a": 1}';
		const service = createService();
		const identifier = await service.loadJsonFile(fileUri);
		const client = service.getInstance(identifier)!.client;

		contents = '{"b": 2}';
		fileChanged(FileChangeType.UPDATED);
		await vi.advanceTimersByTimeAsync(250);
		const afterUpdate = await childNames(service, identifier);

		contents = '{"b": ';
		fileChanged(FileChangeType.UPDATED);
		await vi.advanceTimersByTimeAsync(250);

		expect([afterUpdate, await childNames(service, identifier), client.status]).toEqual([['b'], ['b'], 'error']);
	});

	it('reports a deleted file as an error and recovers when it comes back', async () => {
		contents = '{"a": 1}';
		const service = createService();
		const identifier = await service.loadJsonFile(fileUri);
		const client = service.getInstance(identifier)!.client;

		readFile.mockRejectedValueOnce(new Error('not found'));
		fileChanged(FileChangeType.DELETED);
		await vi.advanceTimersByTimeAsync(250);
		const afterDelete = client.status;

		contents = '{"b": 2}';
		fileChanged(FileChangeType.ADDED);
		await vi.advanceTimersByTimeAsync(250);

		expect([afterDelete, client.status, await childNames(service, identifier)]).toEqual(['error', 'idle', ['b']]);
	});

	it('reports a file that does not parse', async () => {
		contents = 'not json';
		const service = createService();

		await expect(service.loadJsonFile(fileUri)).rejects.toThrow('Could not parse');
	});
});
