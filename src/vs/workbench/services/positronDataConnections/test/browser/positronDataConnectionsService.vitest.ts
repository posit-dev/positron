/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { Emitter } from '../../../../../base/common/event.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { ISecretStorageService } from '../../../../../platform/secrets/common/secrets.js';
import { TestSecretStorageService } from '../../../../../platform/secrets/test/common/testSecretStorageService.js';
import { TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import { NullExtensionService, IExtensionService } from '../../../extensions/common/extensions.js';
import { IEditorCloseEvent, IEditorIdentifier } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IEditorService } from '../../../editor/common/editorService.js';
import { PositronDataExplorerUri } from '../../../positronDataExplorer/common/positronDataExplorerUri.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IDataConnectionDriver, IDataConnectionDriverMetadata, IDataConnectionHandle, IDataConnectionProfile } from '../../common/interfaces/dataConnectionDriver.js';
import { IPositronDataConnectionsService } from '../../common/interfaces/positronDataConnectionsService.js';
import { PositronDataConnectionsService } from '../../browser/positronDataConnectionsService.js';

function createProfile(id: string): IDataConnectionProfile {
	return {
		id,
		driverMetadata: {
			id: 'test-driver',
			name: 'Test Driver',
			iconSvg: '',
			supportedLanguageIds: ['python', 'r'],
		},
		connectionName: `Connection ${id}`,
		mechanismId: 'test-mechanism',
		parameterValues: {},
	};
}

function createDriverMetadata(): IDataConnectionDriverMetadata {
	return {
		id: 'test-driver',
		name: 'Test Driver',
		description: '',
		iconSvg: '',
		supportedLanguageIds: [],
		mechanisms: [{
			id: 'test-mechanism',
			label: 'Test Mechanism',
			description: '',
			parameters: [],
		}],
	};
}

describe('PositronDataConnectionsService', () => {
	// The dataset ids whose Data Explorer editor is currently open. The IEditorService stub below
	// reports an editor for exactly these, so a test can open and close Data Explorer tabs by
	// mutating the set.
	const openDatasetIds = new Set<string>();

	// Fires when a Data Explorer editor closes. Tests close a tab by removing its dataset id from
	// openDatasetIds and firing this, the way the editor part does.
	const onDidCloseEditor = new Emitter<IEditorCloseEvent>();

	// Maps a Data Explorer resource back to the open dataset id it belongs to, or undefined when no
	// open dataset matches it.
	const datasetIdForResource = (resource: URI) => [...openDatasetIds].find(
		datasetId => PositronDataExplorerUri.generate(datasetId).toString() === resource.toString()
	);

	const ctx = createTestContainer()
		.stub(IExtensionService, new NullExtensionService())
		.stub(ILogService, new NullLogService())
		.stub(IEditorService, {
			onDidCloseEditor: onDidCloseEditor.event,
			findEditors: (resource: URI) => datasetIdForResource(resource) !== undefined
				? [stubInterface<IEditorIdentifier>({ editor: stubInterface<EditorInput>({ resource }) })]
				: [],
			closeEditors: async (editors: readonly IEditorIdentifier[]) => {
				for (const { editor } of editors) {
					const datasetId = editor.resource && datasetIdForResource(editor.resource);
					if (datasetId !== undefined) {
						openDatasetIds.delete(datasetId);
					}
				}
				onDidCloseEditor.fire(stubInterface<IEditorCloseEvent>({}));
			},
		})
		.build();

	let storageService: TestStorageService;
	let service: IPositronDataConnectionsService;

	beforeEach(() => {
		openDatasetIds.clear();
		storageService = new TestStorageService();
		ctx.disposables.add(storageService);
		ctx.instantiationService.stub(IStorageService, storageService);
		ctx.instantiationService.stub(ISecretStorageService, new TestSecretStorageService());

		service = ctx.instantiationService.createInstance(PositronDataConnectionsService);
		ctx.disposables.add(service);
	});

	it('has no preferred code variant until one is set', () => {
		service.addUpdateProfile(createProfile('conn-1'));

		expect(service.getProfile('conn-1')?.preferredCodeVariants).toBeUndefined();
	});

	it('sets and round-trips a preferred code variant through storage', () => {
		service.addUpdateProfile(createProfile('conn-1'));
		service.setPreferredCodeVariant('conn-1', 'python', 'sqlalchemy');

		expect(service.getProfile('conn-1')?.preferredCodeVariants).toEqual({ python: 'sqlalchemy' });

		// A fresh service instance backed by the same storage should see the persisted preference.
		const reloaded = ctx.instantiationService.createInstance(PositronDataConnectionsService);
		ctx.disposables.add(reloaded);
		expect(reloaded.getProfile('conn-1')?.preferredCodeVariants).toEqual({ python: 'sqlalchemy' });
	});

	it('keeps preferred variants for other languages when setting a new one', () => {
		service.addUpdateProfile(createProfile('conn-1'));
		service.setPreferredCodeVariant('conn-1', 'python', 'sqlalchemy');
		service.setPreferredCodeVariant('conn-1', 'r', 'dbi');

		expect(service.getProfile('conn-1')?.preferredCodeVariants).toEqual({ python: 'sqlalchemy', r: 'dbi' });
	});

	it('overwrites the preferred variant for the same language', () => {
		service.addUpdateProfile(createProfile('conn-1'));
		service.setPreferredCodeVariant('conn-1', 'python', 'sqlite3');
		service.setPreferredCodeVariant('conn-1', 'python', 'sqlalchemy');

		expect(service.getProfile('conn-1')?.preferredCodeVariants).toEqual({ python: 'sqlalchemy' });
	});

	it('is a no-op when the profile does not exist', () => {
		expect(() => service.setPreferredCodeVariant('missing', 'python', 'sqlalchemy')).not.toThrow();
		expect(service.getProfile('missing')).toBeUndefined();
	});

	it('keeps a secret in secret storage, not plaintext, when re-saved after its driver becomes unregistered', () => {
		const driver = stubInterface<IDataConnectionDriver>({
			id: 'test-driver',
			metadata: {
				id: 'test-driver',
				name: 'Test Driver',
				description: '',
				iconSvg: '',
				supportedLanguageIds: [],
				mechanisms: [{
					id: 'test-mechanism',
					label: 'Test Mechanism',
					description: '',
					parameters: [{ id: 'apiKey', label: 'API Key', type: 'password', secret: true }],
				}],
			},
		});
		service.driverManager.registerDriver(driver);

		// Save once while the driver is registered, so apiKey is recognized as a secret.
		service.addUpdateProfile({ ...createProfile('conn-1'), parameterValues: { apiKey: 'sekret' } });
		expect(service.getProfile('conn-1')?.parameterValues).toEqual({});

		// The driver's extension unloads before the next save; the profile's secret schema is now
		// unknown at save time.
		service.driverManager.removeDriver('test-driver');
		service.addUpdateProfile({ ...createProfile('conn-1'), parameterValues: { apiKey: 'new-sekret' } });

		// The new value must still be routed to secret storage, not leaked as plaintext into the
		// public profile returned by getProfile.
		expect(service.getProfile('conn-1')?.parameterValues).toEqual({});
	});

	describe('open Data Explorers', () => {
		/**
		 * Connects 'conn-1' through a driver that opens a Data Explorer per preview, the way a real
		 * driver does, reporting `datasetIds` in order -- one per preview. An undefined entry stands
		 * for a driver that opens a preview without reporting the dataset id it used.
		 */
		async function connectProfile(datasetIds: readonly (string | undefined)[]) {
			const remainingDatasetIds = [...datasetIds];
			const handle = stubInterface<IDataConnectionHandle>({
				handle: 1,
				nodePreview: async () => {
					const datasetId = remainingDatasetIds.shift();
					if (datasetId !== undefined) {
						openDatasetIds.add(datasetId);
					}
					return datasetId;
				},
				disconnect: async () => { },
				release: () => { },
			});
			service.driverManager.registerDriver(stubInterface<IDataConnectionDriver>({
				id: 'test-driver',
				metadata: createDriverMetadata(),
				connect: async () => handle,
			}));
			service.addUpdateProfile(createProfile('conn-1'));
			return service.connect('conn-1');
		}

		it('reports a Data Explorer previewed from the connection', async () => {
			const instance = await connectProfile(['sqlite:conn-1:table:flights']);

			expect(await service.previewNode(instance.connectionHandle, 7))
				.toBe('sqlite:conn-1:table:flights');
			expect(service.countOpenDataExplorers('conn-1')).toBe(1);
		});

		it('stops reporting one the user has closed', async () => {
			const instance = await connectProfile(['sqlite:conn-1:table:flights']);
			await service.previewNode(instance.connectionHandle, 7);

			// The user closes the Data Explorer tab. The dataset stays recorded against the profile,
			// but it no longer has an editor, so it no longer counts.
			openDatasetIds.clear();

			expect(service.countOpenDataExplorers('conn-1')).toBe(0);
		});

		it('reports nothing for a driver that does not report its dataset ids', async () => {
			const instance = await connectProfile([undefined]);

			expect(await service.previewNode(instance.connectionHandle, 7)).toBeUndefined();
			expect(service.countOpenDataExplorers('conn-1')).toBe(0);
		});

		it('forgets a profile\'s previews once it disconnects', async () => {
			const instance = await connectProfile(['sqlite:conn-1:table:flights']);
			await service.previewNode(instance.connectionHandle, 7);

			await service.disconnect('conn-1');

			// The editor outlives the connection, but the connection's record of it does not: a
			// reconnect mints fresh dataset ids, so the old ones must not carry over.
			expect(openDatasetIds.size).toBe(1);
			expect(service.countOpenDataExplorers('conn-1')).toBe(0);
		});

		it('reports nothing for a profile that has never been previewed', async () => {
			await connectProfile(['sqlite:conn-1:table:flights']);

			expect(service.countOpenDataExplorers('conn-1')).toBe(0);
		});

		describe('disconnectWhenUnused', () => {
			// Closes the Data Explorer for the given dataset id, as the editor part does: the editor
			// leaves its group first, then the close event fires.
			function closeDataExplorer(datasetId: string) {
				openDatasetIds.delete(datasetId);
				onDidCloseEditor.fire(stubInterface<IEditorCloseEvent>({}));
			}

			it('closes the connection right away when nothing is using it', async () => {
				await connectProfile([]);

				service.disconnectWhenUnused('conn-1');

				expect(service.getInstanceForProfile('conn-1')).toBeUndefined();
			});

			it('waits for the last Data Explorer to close, then closes the connection', async () => {
				const instance = await connectProfile(['sqlite:conn-1:table:flights']);
				await service.previewNode(instance.connectionHandle, 7);

				service.disconnectWhenUnused('conn-1');
				expect(service.getInstanceForProfile('conn-1')).toBeDefined();

				closeDataExplorer('sqlite:conn-1:table:flights');

				expect(service.getInstanceForProfile('conn-1')).toBeUndefined();
			});

			it('keeps the connection while another Data Explorer is still open', async () => {
				const instance = await connectProfile([
					'sqlite:conn-1:table:flights',
					'sqlite:conn-1:table:airports',
				]);
				await service.previewNode(instance.connectionHandle, 7);
				await service.previewNode(instance.connectionHandle, 8);

				service.disconnectWhenUnused('conn-1');
				closeDataExplorer('sqlite:conn-1:table:flights');

				expect(service.getInstanceForProfile('conn-1')).toBeDefined();

				closeDataExplorer('sqlite:conn-1:table:airports');

				expect(service.getInstanceForProfile('conn-1')).toBeUndefined();
			});

			it('keeps the connection when the pending close is cancelled', async () => {
				const instance = await connectProfile(['sqlite:conn-1:table:flights']);
				await service.previewNode(instance.connectionHandle, 7);
				service.disconnectWhenUnused('conn-1');

				service.cancelDisconnectWhenUnused('conn-1');
				closeDataExplorer('sqlite:conn-1:table:flights');

				expect(service.getInstanceForProfile('conn-1')).toBeDefined();
			});

			it('is a no-op for a profile with no live connection', () => {
				service.addUpdateProfile(createProfile('conn-1'));

				expect(() => service.disconnectWhenUnused('conn-1')).not.toThrow();
			});
		});

		describe('removeProfile', () => {
			it('closes the connection of a removed profile', async () => {
				await connectProfile([]);

				service.removeProfile('conn-1');

				// Removing the profile takes away the only UI for managing its connection, so leaving
				// the connection open would leak it for the rest of the session.
				expect(service.getProfile('conn-1')).toBeUndefined();
				await vi.waitFor(() => {
					expect(service.getInstanceForProfile('conn-1')).toBeUndefined();
				});
			});

			it('closes the Data Explorers previewed from a removed profile', async () => {
				const instance = await connectProfile([
					'sqlite:conn-1:table:flights',
					'sqlite:conn-1:table:airports',
				]);
				await service.previewNode(instance.connectionHandle, 7);
				await service.previewNode(instance.connectionHandle, 8);

				service.removeProfile('conn-1');

				// Their backends die with the connection, so they would only survive as grids that
				// error on the next interaction.
				await vi.waitFor(() => {
					expect(openDatasetIds.size).toBe(0);
				});
				await vi.waitFor(() => {
					expect(service.getInstanceForProfile('conn-1')).toBeUndefined();
				});
			});

			it('is a no-op for a profile that does not exist', () => {
				expect(() => service.removeProfile('missing')).not.toThrow();
			});
		});
	});
});
