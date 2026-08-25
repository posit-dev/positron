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
import { IDataConnectionDriver, IDataConnectionDriverMetadata, IDataConnectionHandle, IDataConnectionParameter, IDataConnectionProfile } from '../../common/interfaces/dataConnectionDriver.js';
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
		// How many times the driver's connection handle has been torn down, so a test can tell a
		// single teardown from a double one. Reset by connectProfile.
		let handleDisconnects = 0;

		/**
		 * Connects 'conn-1' through a driver that opens a Data Explorer per preview, the way a real
		 * driver does, reporting `datasetIds` in order -- one per preview. An undefined entry stands
		 * for a driver that opens a preview without reporting the dataset id it used.
		 */
		async function connectProfile(datasetIds: readonly (string | undefined)[]) {
			const remainingDatasetIds = [...datasetIds];
			handleDisconnects = 0;
			const handle = stubInterface<IDataConnectionHandle>({
				handle: 1,
				nodePreview: async () => {
					const datasetId = remainingDatasetIds.shift();
					if (datasetId !== undefined) {
						openDatasetIds.add(datasetId);
					}
					return datasetId;
				},
				disconnect: async () => { handleDisconnects++; },
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

		it('closes and forgets a profile\'s previews when it disconnects', async () => {
			const instance = await connectProfile(['sqlite:conn-1:table:flights']);
			await service.previewNode(instance.connectionHandle, 7);

			await service.disconnect('conn-1');

			// The Data Explorer's backend died with the connection, so its tab goes too; the record of
			// it goes with it, since a reconnect mints fresh dataset ids that must not collide with
			// the old ones.
			expect(openDatasetIds.size).toBe(0);
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

		describe('disconnect', () => {
			it('closes every Data Explorer previewed from the connection, without waiting for them', async () => {
				const instance = await connectProfile([
					'sqlite:conn-1:table:flights',
					'sqlite:conn-1:table:airports',
				]);
				await service.previewNode(instance.connectionHandle, 7);
				await service.previewNode(instance.connectionHandle, 8);

				await service.disconnect('conn-1');

				// Unlike disconnectWhenUnused, open Data Explorers don't hold the connection up here:
				// the user asked to disconnect, and their backends die with the connection anyway.
				expect({
					openDataExplorers: openDatasetIds.size,
					connected: service.getInstanceForProfile('conn-1') !== undefined,
				}).toMatchInlineSnapshot(`
					{
					  "connected": false,
					  "openDataExplorers": 0,
					}
				`);
			});

			it('is a no-op for a profile with no live connection', async () => {
				service.addUpdateProfile(createProfile('conn-1'));

				await expect(service.disconnect('conn-1')).resolves.toBeUndefined();
			});

			// The reentrancy guard: closing the editors fires onDidCloseEditor, which drains the
			// pending-close set. The profile must already look disconnected to that handler, or it
			// would disconnect the same connection a second time underneath this one.
			it('disconnects once when a pending close is already waiting on the Data Explorer', async () => {
				const instance = await connectProfile(['sqlite:conn-1:table:flights']);
				await service.previewNode(instance.connectionHandle, 7);

				// The tree gave up its use of the connection first (a collapse), leaving the close
				// waiting on the preview. The user then disconnects outright.
				service.disconnectWhenUnused('conn-1');
				await service.disconnect('conn-1');

				expect({ handleDisconnects, openDataExplorers: openDatasetIds.size }).toMatchInlineSnapshot(`
					{
					  "handleDisconnects": 1,
					  "openDataExplorers": 0,
					}
				`);
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

	describe('discovered connections', () => {
		// Registers a driver reporting the given discoveries and waits for the service to publish
		// them. Registration fires onDidChangeDrivers, which is what triggers the refresh.
		const registerDiscoveringDriver = async (
			discovered: Array<{ id: string; name: string; description?: string; mechanismId: string; parameterValues: Record<string, string> }>
		) => {
			service.driverManager.registerDriver(stubInterface<IDataConnectionDriver>({
				id: 'test-driver',
				metadata: createDriverMetadata(),
				discoverConnections: async () => discovered,
			}));
			await vi.waitFor(() => {
				expect(service.getDiscoveredProfiles().length).toBe(discovered.length);
			});
		};

		const pagila = {
			id: 'odbc-dsn:Pagila',
			name: 'Pagila',
			description: 'localhost:5432/pagila',
			mechanismId: 'test-mechanism',
			parameterValues: { dsn: 'Pagila' },
		};

		it('publishes a driver\'s discoveries as ephemeral profiles, namespaced by driver', async () => {
			await registerDiscoveringDriver([pagila]);

			expect(service.getDiscoveredProfiles()).toEqual([{
				id: 'discovered:test-driver:odbc-dsn:Pagila',
				driverMetadata: {
					id: 'test-driver',
					name: 'Test Driver',
					iconSvg: '',
					supportedLanguageIds: [],
				},
				connectionName: 'Pagila',
				description: 'localhost:5432/pagila',
				mechanismId: 'test-mechanism',
				parameterValues: { dsn: 'Pagila' },
				discovered: true,
			}]);

			// Discoveries are never persisted, so they must not show up among the saved profiles.
			expect(service.getProfiles()).toEqual([]);
		});

		it('reports the full catalog through getAllProfiles, saved profiles first', async () => {
			await registerDiscoveringDriver([pagila]);
			service.addUpdateProfile(createProfile('saved-1'));

			expect(service.getAllProfiles().map(profile => profile.id)).toEqual([
				'saved-1',
				'discovered:test-driver:odbc-dsn:Pagila',
			]);
		});

		// Saving one of two discoveries must not take the other down with it. They cannot be told
		// apart by comparing values -- two data sources can differ only in a password, which no
		// profile carries in public -- so the saved profile records which discovery it came from
		// and exactly that one stops being reported.
		it('stops reporting the discovery a profile was saved from, and only that one', async () => {
			await registerDiscoveringDriver([
				pagila,
				{ ...pagila, id: 'odbc-dsn:Pagila (readonly)', name: 'Pagila (readonly)' },
			]);

			service.saveDiscoveredProfile('discovered:test-driver:odbc-dsn:Pagila');

			expect(service.getDiscoveredProfiles().map(profile => profile.connectionName))
				.toEqual(['Pagila (readonly)']);
		});

		// A profile the user typed in by hand has no link to any discovery, so it is matched by
		// value instead -- including its name, without which two data sources differing only in a
		// credential would look identical to this comparison.
		it('hides a discovery a hand-configured profile matches, name included', async () => {
			await registerDiscoveringDriver([pagila]);

			const handConfigured = {
				...createProfile('saved-1'),
				connectionName: 'Pagila',
				mechanismId: 'test-mechanism',
				parameterValues: { dsn: 'Pagila' },
			};
			service.addUpdateProfile(handConfigured);
			expect(service.getDiscoveredProfiles()).toEqual([]);

			// Same values under another name is another connection, and stays visible.
			service.addUpdateProfile({ ...handConfigured, connectionName: 'Pagila (readonly)' });
			expect(service.getDiscoveredProfiles().map(profile => profile.connectionName)).toEqual(['Pagila']);
		});

		it('saves a discovery as an ordinary profile under a fresh id, and stops reporting it', async () => {
			await registerDiscoveringDriver([pagila]);

			const savedId = service.saveDiscoveredProfile('discovered:test-driver:odbc-dsn:Pagila');
			const saved = service.getProfile(savedId!);

			// The saved profile keeps the connection's identity but sheds every trace of having
			// been discovered -- both marker fields are gone, not merely undefined -- so the pane
			// treats it as the user's own from here on. Its id is fresh, since the discovered id
			// belongs to a discovery that may later disappear.
			expect({
				...saved,
				id: savedId === 'discovered:test-driver:odbc-dsn:Pagila' ? savedId : '<fresh-id>',
				createdAt: typeof saved?.createdAt,
			}).toEqual({
				id: '<fresh-id>',
				createdAt: 'number',
				driverMetadata: {
					id: 'test-driver',
					name: 'Test Driver',
					iconSvg: '',
					supportedLanguageIds: [],
				},
				connectionName: 'Pagila',
				mechanismId: 'test-mechanism',
				parameterValues: { dsn: 'Pagila' },
				// What it was saved from, which is what suppresses that discovery's own row.
				discoveredFromId: 'discovered:test-driver:odbc-dsn:Pagila',
			});
			expect(service.getDiscoveredProfiles()).toEqual([]);
		});

		it('resolves a discovery by id so it can be connected without being saved first', async () => {
			await registerDiscoveringDriver([pagila]);

			const id = 'discovered:test-driver:odbc-dsn:Pagila';
			expect(service.getProfile(id)?.connectionName).toBe('Pagila');
			// A discovery holds no secrets, so resolving it with secrets is the same profile.
			await expect(service.getProfileWithSecrets(id)).resolves.toMatchObject({ connectionName: 'Pagila' });
		});

		// A driver's discovery may carry a value its mechanism declares secret (e.g. a password
		// embedded in a connection string). The service splits it out at discovery time -- the
		// profiles every consumer sees (and the catalog command renders verbatim) stay secret-free
		// -- and merges it back only for the connect, via getProfileWithSecrets. Saving the
		// discovery routes the value into secret storage like any other saved secret.
		it('splits secret-declared discovery values out of the public profile, keeping them for connect and save', async () => {
			service.driverManager.registerDriver(stubInterface<IDataConnectionDriver>({
				id: 'test-driver',
				metadata: {
					...createDriverMetadata(),
					mechanisms: [{
						id: 'test-mechanism',
						label: 'Test Mechanism',
						description: '',
						parameters: [{ id: 'pwd', label: 'Password', type: 'password', secret: true }],
					}],
				},
				discoverConnections: async () => [{ ...pagila, parameterValues: { dsn: 'Pagila', pwd: 'hunter2' } }],
			}));
			await vi.waitFor(() => {
				expect(service.getDiscoveredProfiles().length).toBe(1);
			});

			const id = 'discovered:test-driver:odbc-dsn:Pagila';
			// The public form is secret-free, while the secret it holds aside is still reported as
			// one -- a display-safe view must know to redact it rather than be told there is
			// nothing there.
			expect(service.getProfile(id)?.parameterValues).toEqual({ dsn: 'Pagila' });
			expect(service.getProfileSecretIds(id)).toEqual(['pwd']);
			// ...while the connect-time form has the value the driver reported.
			await expect(service.getProfileWithSecrets(id)).resolves.toMatchObject({
				parameterValues: { dsn: 'Pagila', pwd: 'hunter2' },
			});

			// Saving the discovery keeps the secret out of the public profile and round-trips it
			// through secret storage.
			const savedId = service.saveDiscoveredProfile(id)!;
			expect(service.getProfile(savedId)?.parameterValues).toEqual({ dsn: 'Pagila' });
			await vi.waitFor(async () => {
				await expect(service.getProfileWithSecrets(savedId)).resolves.toMatchObject({
					parameterValues: { dsn: 'Pagila', pwd: 'hunter2' },
				});
			});
		});

		it('is a no-op when the id is not a current discovery', () => {
			expect(service.saveDiscoveredProfile('discovered:test-driver:missing')).toBeUndefined();
			expect(service.getProfiles()).toEqual([]);
		});

		it('keeps other drivers\' discoveries when one driver\'s discovery fails', async () => {
			service.driverManager.registerDriver(stubInterface<IDataConnectionDriver>({
				id: 'broken-driver',
				metadata: { ...createDriverMetadata(), id: 'broken-driver' },
				discoverConnections: async () => { throw new Error('odbc.ini is unreadable'); },
			}));
			await registerDiscoveringDriver([pagila]);

			expect(service.getDiscoveredProfiles().map(profile => profile.connectionName)).toEqual(['Pagila']);
		});
	});
	// Every parameter is offered to the driver for redaction, not only the ones the mechanism
	// declares secret: a credential can sit inside an ordinary string parameter (an ODBC connection
	// string embedding PWD=), and only the driver knows its own formats well enough to find it.
	describe('getDisplayParameterValues', () => {
		// A driver that masks the password inside any value carrying one, and reports nothing to
		// redact in the rest -- the shape a real driver's format-specific redaction has.
		const registerRedactingDriver = (parameters: IDataConnectionParameter[]) => {
			service.driverManager.registerDriver(stubInterface<IDataConnectionDriver>({
				id: 'test-driver',
				metadata: {
					...createDriverMetadata(),
					mechanisms: [{ id: 'test-mechanism', label: 'Test Mechanism', description: '', parameters }],
				},
				redactParameterValue: async (_mechanismId: string, _parameterId: string, value: string) =>
					value.includes('PWD=') ? value.replace(/PWD=[^;]*/, 'PWD=****') : undefined,
				discoverConnections: async () => [],
			}));
		};

		it('masks a credential the driver finds in a parameter the mechanism does not call secret', async () => {
			registerRedactingDriver([{ id: 'connectionString', label: 'Connection String', type: 'string' }]);
			service.addUpdateProfile({
				...createProfile('conn-1'),
				parameterValues: { connectionString: 'DSN=Pagila;UID=admin;PWD=hunter2' },
			});

			await expect(service.getDisplayParameterValues('conn-1')).resolves.toEqual({
				connectionString: 'DSN=Pagila;UID=admin;PWD=****',
			});
		});

		it('leaves out a secret the driver reports nothing to redact in, rather than passing it through', async () => {
			registerRedactingDriver([{ id: 'pwd', label: 'Password', type: 'password' }]);
			service.addUpdateProfile({
				...createProfile('conn-1'),
				parameterValues: { dsn: 'Pagila', pwd: 'hunter2' },
			});

			await expect(service.getDisplayParameterValues('conn-1')).resolves.toEqual({ dsn: 'Pagila' });
		});

		// A discovery's secrets live in the service rather than in secret storage, so a display-safe
		// view that only knew about secret storage would render them as if they were ordinary values.
		it('redacts a discovered connection\'s secret the same way a saved one\'s is', async () => {
			service.driverManager.registerDriver(stubInterface<IDataConnectionDriver>({
				id: 'test-driver',
				metadata: {
					...createDriverMetadata(),
					mechanisms: [{
						id: 'test-mechanism',
						label: 'Test Mechanism',
						description: '',
						parameters: [{ id: 'pwd', label: 'Password', type: 'password' }],
					}],
				},
				redactParameterValue: async (_mechanismId: string, _parameterId: string, value: string) =>
					value.includes('PWD=') ? value.replace(/PWD=[^;]*/, 'PWD=****') : undefined,
				discoverConnections: async () => [{
					id: 'odbc-dsn:Pagila',
					name: 'Pagila',
					mechanismId: 'test-mechanism',
					parameterValues: { dsn: 'Pagila', pwd: 'PWD=hunter2' },
				}],
			}));
			await vi.waitFor(() => {
				expect(service.getDiscoveredProfiles().length).toBe(1);
			});

			await expect(service.getDisplayParameterValues('discovered:test-driver:odbc-dsn:Pagila'))
				.resolves.toEqual({ dsn: 'Pagila', pwd: 'PWD=****' });
		});

		// Nothing can be redacted without a driver, and passing values through unredacted is what
		// this method exists to avoid, so it stops at what the profile holds in public.
		it('falls back to the profile\'s secret-free values when the driver is unregistered', async () => {
			service.addUpdateProfile({
				...createProfile('conn-1'),
				parameterValues: { connectionString: 'DSN=Pagila;PWD=hunter2' },
			});

			await expect(service.getDisplayParameterValues('conn-1')).resolves.toEqual({
				connectionString: 'DSN=Pagila;PWD=hunter2',
			});
		});

		it('is empty for a profile that does not exist', async () => {
			await expect(service.getDisplayParameterValues('missing')).resolves.toEqual({});
		});
	});
});
