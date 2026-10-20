/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { Emitter } from '../../../../../base/common/event.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
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
import { IViewsService } from '../../../views/common/viewsService.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../../platform/workspace/common/workspace.js';
import { DataConnectionNodeKind, IDataConnectionDriver, IDataConnectionDriverMetadata, IDataConnectionHandle, IDataConnectionParameter, IDataConnectionProfile } from '../../common/interfaces/dataConnectionDriver.js';
import { IPositronDataConnectionsService, POSITRON_DATA_CONNECTIONS_VIEW_ID } from '../../common/interfaces/positronDataConnectionsService.js';
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

	// Records the views revealNode asked to open, so a test can tell an opened pane from a silent
	// refusal.
	const openedViews: string[] = [];

	// Whether the window has a folder open, which is what lets a profile be scoped to the
	// workspace. A test sets EMPTY to model a window with no folder open.
	let workbenchState = WorkbenchState.FOLDER;

	const ctx = createTestContainer()
		.stub(IWorkspaceContextService, { getWorkbenchState: () => workbenchState })
		.stub(IExtensionService, new NullExtensionService())
		.stub(ILogService, new NullLogService())
		.stub(IViewsService, {
			openView: async (id: string) => {
				openedViews.push(id);
				return null;
			},
		})
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
		openedViews.length = 0;
		workbenchState = WorkbenchState.FOLDER;
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

	describe('DuckDB read-only correction', () => {
		// A DuckDB profile with the given Read Only value.
		const duckdbProfile = (id: string, readOnly: boolean): IDataConnectionProfile => ({
			...createProfile(id),
			driverMetadata: { ...createProfile(id).driverMetadata, id: 'positron-data-driver-duckdb' },
			parameterValues: { databasePath: '/tmp/db.duckdb', readOnly },
		});

		// Writes a profile into storage the way an older Positron would have left it. Seeding
		// directly rather than through a service matters: constructing a service is what marks the
		// correction as applied, so a service built against this storage first would suppress it.
		const persistProfile = (storage: TestStorageService, profile: IDataConnectionProfile) =>
			storage.store(
				`positron.dataConnections.profile.${profile.id}`,
				JSON.stringify({ profile, secretParameterIds: [] }),
				StorageScope.PROFILE,
				StorageTarget.USER,
			);

		// A storage no service has been constructed against, so the correction has yet to run.
		const unmigratedStorage = () => {
			const storage = new TestStorageService();
			ctx.disposables.add(storage);
			ctx.instantiationService.stub(IStorageService, storage);
			return storage;
		};

		// Starts a service against the current storage, as a window start would.
		const startService = () => {
			const started = ctx.instantiationService.createInstance(PositronDataConnectionsService);
			ctx.disposables.add(started);
			return started;
		};

		it('turns Read Only on for DuckDB profiles only', () => {
			const storage = unmigratedStorage();
			persistProfile(storage, duckdbProfile('duck-1', false));
			persistProfile(storage, { ...createProfile('other-1'), parameterValues: { readOnly: false } });

			const started = startService();

			expect({
				duckdb: started.getProfile('duck-1')?.parameterValues.readOnly,
				other: started.getProfile('other-1')?.parameterValues.readOnly,
			}).toEqual({ duckdb: true, other: false });
		});

		it('leaves Read Only off when the user turns it off after the correction', () => {
			const storage = unmigratedStorage();
			persistProfile(storage, duckdbProfile('duck-1', false));

			// The correction runs on this start, and the user then turns Read Only back off.
			startService().addUpdateProfile(duckdbProfile('duck-1', false));

			// A later start must respect that choice rather than correcting it again.
			expect(startService().getProfile('duck-1')?.parameterValues.readOnly).toBe(false);
		});
	});

	describe('connect', () => {
		// Registers a driver whose connect() is counted, failing the first `failures` calls.
		const registerDriver = (failures = 0) => {
			const driverConnect = vi.fn(async () => {
				if (driverConnect.mock.calls.length <= failures) {
					throw new Error('connection refused');
				}
				return stubInterface<IDataConnectionHandle>({ handle: 1 });
			});
			service.driverManager.registerDriver(stubInterface<IDataConnectionDriver>({
				id: 'test-driver',
				metadata: createDriverMetadata(),
				connect: driverConnect,
			}));
			service.addUpdateProfile(createProfile('conn-1'));
			return driverConnect;
		};

		it('opens one connection for overlapping connects to the same profile', async () => {
			// An extension opening the connection while the user expands the same entry: both ask
			// before either has registered an instance.
			const driverConnect = registerDriver();

			const [first, second] = await Promise.all([service.connect('conn-1'), service.connect('conn-1')]);

			expect({
				driverConnects: driverConnect.mock.calls.length,
				sameInstance: first === second,
				instances: service.getInstances().length,
			}).toEqual({ driverConnects: 1, sameInstance: true, instances: 1 });
		});

		it('tries again after a connect that failed', async () => {
			const driverConnect = registerDriver(1);

			await expect(service.connect('conn-1')).rejects.toThrow('connection refused');
			await service.connect('conn-1');

			expect(driverConnect.mock.calls.length).toBe(2);
		});
	});

	describe('editing a connected profile', () => {
		// Saves 'conn-1' with the given parameter values and connects it. `parameters` declares the
		// mechanism's schema, which is what tells the service which values are secret.
		const connectProfile = (
			parameterValues: Record<string, boolean | number | string>,
			parameters: IDataConnectionDriverMetadata['mechanisms'][number]['parameters'] = []
		) => {
			const metadata = createDriverMetadata();
			service.driverManager.registerDriver(stubInterface<IDataConnectionDriver>({
				id: 'test-driver',
				metadata: { ...metadata, mechanisms: [{ ...metadata.mechanisms[0], parameters }] },
				connect: async () => stubInterface<IDataConnectionHandle>({
					handle: 1,
					disconnect: async () => { },
					release: () => { },
				}),
			}));
			service.addUpdateProfile({ ...createProfile('conn-1'), parameterValues });
			return service.connect('conn-1');
		};

		it('closes the connection when a parameter value changes', async () => {
			await connectProfile({ databasePath: '/tmp/db.duckdb', readOnly: false });

			// The user turns Read Only on. The live connection still holds the exclusive file lock
			// that the new value was chosen to release, so it must not survive the edit.
			//
			// The close is fire-and-forget, so this asserts on disconnect() dropping the instance
			// before its first await -- which it must, since closing an editor lands back in
			// disconnect() for the same profile and the drop is what makes that a no-op.
			service.addUpdateProfile({
				...createProfile('conn-1'),
				parameterValues: { databasePath: '/tmp/db.duckdb', readOnly: true },
			});

			expect(service.getInstanceForProfile('conn-1')).toBeUndefined();
		});

		it('closes the connection when a secret is retyped', async () => {
			await connectProfile({ host: 'db.example.com', apiKey: 'sekret' }, [
				{ id: 'apiKey', label: 'API Key', type: 'password', secret: true },
			]);

			// A secret is stripped from the sanitized values on both sides of the comparison, so it
			// cannot be caught by comparing them -- and a connection left running on rotated
			// credentials is exactly the case that must not be missed.
			service.addUpdateProfile({
				...createProfile('conn-1'),
				parameterValues: { host: 'db.example.com', apiKey: 'new-sekret' },
			});

			expect(service.getInstanceForProfile('conn-1')).toBeUndefined();
		});

		it('reports in advance whether a save would close the connection', async () => {
			await connectProfile({ databasePath: '/tmp/db.duckdb', readOnly: false });

			// What the edit dialog asks before warning the user that their Data Explorers will close.
			const edited = (readOnly: boolean) => ({
				...createProfile('conn-1'),
				parameterValues: { databasePath: '/tmp/db.duckdb', readOnly },
			});
			expect({
				changed: service.wouldCloseConnection(edited(true)),
				unchanged: service.wouldCloseConnection(edited(false)),
			}).toEqual({ changed: true, unchanged: false });
		});

		it('keeps the connection when the edit leaves parameter values alone', async () => {
			await connectProfile({ databasePath: '/tmp/db.duckdb', readOnly: true });

			// Renaming touches nothing the connection was opened with.
			service.addUpdateProfile({
				...createProfile('conn-1'),
				connectionName: 'Renamed',
				parameterValues: { databasePath: '/tmp/db.duckdb', readOnly: true },
			});

			expect(service.getInstanceForProfile('conn-1')).toBeDefined();
		});

		it('keeps the connection, and its stored secrets, when only the scope changes', async () => {
			await connectProfile({ host: 'db.example.com', apiKey: 'sekret' }, [
				{ id: 'apiKey', label: 'API Key', type: 'password', secret: true },
			]);

			// The edit dialog leaves an untouched secret field blank, so the secret is absent here.
			service.addUpdateProfile({ ...createProfile('conn-1'), parameterValues: { host: 'db.example.com' }, scope: 'workspace' });

			expect({
				connected: service.getInstanceForProfile('conn-1') !== undefined,
				parameterValues: (await service.getProfileWithSecrets('conn-1'))?.parameterValues,
			}).toEqual({ connected: true, parameterValues: { host: 'db.example.com', apiKey: 'sekret' } });
		});
	});

	describe('open Data Explorers', () => {
		// How many times the driver's connection handle has been torn down and released, so a test
		// can tell a single teardown from a double one. Reset by connectProfile.
		let handleDisconnects = 0;
		let handleReleases = 0;

		/**
		 * Connects 'conn-1' through a driver that opens a Data Explorer per preview, the way a real
		 * driver does, reporting `datasetIds` in order -- one per preview. An undefined entry stands
		 * for a driver that opens a preview without reporting the dataset id it used.
		 */
		async function connectProfile(datasetIds: readonly (string | undefined)[]) {
			const remainingDatasetIds = [...datasetIds];
			handleDisconnects = 0;
			handleReleases = 0;
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
				release: () => { handleReleases++; },
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

		describe('a driver going away', () => {
			/** Connects 'conn-2' through a second driver, returning a count of its teardowns. */
			async function connectOtherDriver() {
				const otherHandle = stubInterface<IDataConnectionHandle>({
					handle: 2,
					disconnect: vi.fn(async () => { }),
					release: () => { },
				});
				service.driverManager.registerDriver(stubInterface<IDataConnectionDriver>({
					id: 'other-driver',
					metadata: { ...createDriverMetadata(), id: 'other-driver' },
					connect: async () => otherHandle,
				}));
				const profile = createProfile('conn-2');
				service.addUpdateProfile({ ...profile, driverMetadata: { ...profile.driverMetadata, id: 'other-driver' } });
				await service.connect('conn-2');
				return otherHandle;
			}

			// The ODBC driver re-registers when odbc.ini changes, which unregisters it first. The
			// extension host leaves its connections open for the service to close, so the pane can't
			// go on showing one as connected after it is gone.
			it('closes the connection and its Data Explorers, and only that driver\'s', async () => {
				const instance = await connectProfile(['sqlite:conn-1:table:flights']);
				await service.previewNode(instance.connectionHandle, 7);
				const otherHandle = await connectOtherDriver();
				const instancesEvents: string[][] = [];
				ctx.disposables.add(service.onDidChangeInstances(instances =>
					instancesEvents.push(instances.map(i => i.profileId))));

				service.driverManager.removeDriver('test-driver');

				await vi.waitFor(() => {
					expect(handleReleases).toBe(1);
				});
				expect({
					handleDisconnects,
					handleReleases,
					openDataExplorers: openDatasetIds.size,
					connectedProfiles: service.getInstances().map(i => i.profileId),
					instancesEvents,
					otherDriverDisconnects: vi.mocked(otherHandle.disconnect).mock.calls.length,
				}).toMatchInlineSnapshot(`
					{
					  "connectedProfiles": [
					    "conn-2",
					  ],
					  "handleDisconnects": 1,
					  "handleReleases": 1,
					  "instancesEvents": [
					    [
					      "conn-2",
					    ],
					  ],
					  "openDataExplorers": 0,
					  "otherDriverDisconnects": 0,
					}
				`);
			});

			// Snowflake updates its driver in place (onDidChange) rather than re-registering; its
			// connections are meant to survive that.
			it('keeps the connection when the driver is replaced under the same id', async () => {
				await connectProfile([]);

				service.driverManager.registerDriver(stubInterface<IDataConnectionDriver>({
					id: 'test-driver',
					metadata: createDriverMetadata(),
				}));

				expect({
					connected: service.getInstanceForProfile('conn-1') !== undefined,
					handleDisconnects,
				}).toEqual({ connected: true, handleDisconnects: 0 });
			});

			it('closes a connection that finishes opening after its driver was removed', async () => {
				let finishConnecting!: (handle: IDataConnectionHandle) => void;
				const driverConnect = vi.fn(() => new Promise<IDataConnectionHandle>(resolve => { finishConnecting = resolve; }));
				service.driverManager.registerDriver(stubInterface<IDataConnectionDriver>({
					id: 'test-driver',
					metadata: createDriverMetadata(),
					connect: driverConnect,
				}));
				service.addUpdateProfile(createProfile('conn-1'));
				const disconnect = vi.fn(async () => { });
				const release = vi.fn();

				const connecting = service.connect('conn-1');
				await vi.waitFor(() => {
					expect(driverConnect).toHaveBeenCalled();
				});
				service.driverManager.removeDriver('test-driver');
				finishConnecting(stubInterface<IDataConnectionHandle>({ handle: 1, disconnect, release }));

				await expect(connecting).rejects.toThrow('was removed while connecting');
				expect({
					connected: service.getInstanceForProfile('conn-1') !== undefined,
					disconnects: disconnect.mock.calls.length,
					releases: release.mock.calls.length,
				}).toEqual({ connected: false, disconnects: 1, releases: 1 });
			});

			// The ODBC driver unregisters and re-registers back to back. The connection itself is
			// live, so one that lands after the driver is back keeps going.
			it('keeps a connection that finishes opening after its driver was re-registered', async () => {
				let finishConnecting!: (handle: IDataConnectionHandle) => void;
				const driverConnect = vi.fn(() => new Promise<IDataConnectionHandle>(resolve => { finishConnecting = resolve; }));
				const driver = stubInterface<IDataConnectionDriver>({
					id: 'test-driver',
					metadata: createDriverMetadata(),
					connect: driverConnect,
				});
				service.driverManager.registerDriver(driver);
				service.addUpdateProfile(createProfile('conn-1'));
				const disconnect = vi.fn(async () => { });

				const connecting = service.connect('conn-1');
				await vi.waitFor(() => {
					expect(driverConnect).toHaveBeenCalled();
				});
				service.driverManager.removeDriver('test-driver');
				service.driverManager.registerDriver(driver);
				finishConnecting(stubInterface<IDataConnectionHandle>({ handle: 1, disconnect }));

				await connecting;
				expect({
					connected: service.getInstanceForProfile('conn-1') !== undefined,
					disconnects: disconnect.mock.calls.length,
				}).toEqual({ connected: true, disconnects: 0 });
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

		// A profile saved from the pane on a build before `discoveredFromId` existed carries no link
		// to its discovery, and was suppressed purely by matching driver, mechanism and values --
		// so renaming it was free. Now that the value match includes the name, the link has to be
		// recovered on the way in, or the rename brings the discovery back as a duplicate row.
		describe('profiles persisted before provenance was recorded', () => {
			// Writes the profile the way an older build did: no `discoveredFromId`, and none of the
			// marker this build stamps on everything it persists.
			const persistLegacyProfile = (profile: IDataConnectionProfile) => {
				storageService.store(
					`positron.dataConnections.profile.${profile.id}`,
					JSON.stringify({ profile, secretParameterIds: [] }),
					StorageScope.PROFILE,
					StorageTarget.USER,
				);
				const reloaded = ctx.instantiationService.createInstance(PositronDataConnectionsService);
				ctx.disposables.add(reloaded);
				return reloaded;
			};

			const registerPagilaDriver = (target: IPositronDataConnectionsService) =>
				target.driverManager.registerDriver(stubInterface<IDataConnectionDriver>({
					id: 'test-driver',
					metadata: createDriverMetadata(),
					discoverConnections: async () => [pagila],
				}));

			it('links one to the discovery it matches, so a rename can\'t resurrect it', async () => {
				// Saved from this discovery, renamed since, with nothing recording where it came from.
				const reloaded = persistLegacyProfile({
					...createProfile('saved-1'),
					connectionName: 'Pagila (prod)',
					parameterValues: { dsn: 'Pagila' },
				});
				registerPagilaDriver(reloaded);

				await vi.waitFor(() => {
					expect(reloaded.getProfile('saved-1')?.discoveredFromId)
						.toBe('discovered:test-driver:odbc-dsn:Pagila');
				});
				expect(reloaded.getDiscoveredProfiles()).toEqual([]);
			});

			// A stale global copy can be an unmarked one. When this workspace's copy, which this build
			// wrote and marked, is the one in use, there is nothing to backfill.
			it('leaves a profile alone when the copy in use is a marked workspace copy', async () => {
				storageService.store(
					'positron.dataConnections.profile.saved-1',
					JSON.stringify({
						profile: { ...createProfile('saved-1'), connectionName: 'Pagila (prod)', parameterValues: { dsn: 'Pagila' } },
						secretParameterIds: [],
						provenanceChecked: true,
					}),
					StorageScope.WORKSPACE,
					StorageTarget.USER,
				);
				const reloaded = persistLegacyProfile({
					...createProfile('saved-1'),
					connectionName: 'Pagila (prod)',
					parameterValues: { dsn: 'Pagila' },
				});
				registerPagilaDriver(reloaded);

				await vi.waitFor(() => {
					expect(reloaded.getDiscoveredProfiles().map(profile => profile.connectionName))
						.toEqual(['Pagila']);
				});
				expect(reloaded.getProfile('saved-1')?.discoveredFromId).toBeUndefined();
			});

			// The backfill exists for profiles an older build left unmarked. A profile saved by this
			// build already says where it came from -- including by saying nothing, for one the user
			// typed in -- so a same-shaped discovery under another name stays a row of its own.
			it('leaves a profile this build persisted alone, discovery and all', async () => {
				const reloaded = persistLegacyProfile(createProfile('saved-1'));
				reloaded.addUpdateProfile({
					...createProfile('saved-2'),
					connectionName: 'Pagila (prod)',
					parameterValues: { dsn: 'Pagila' },
				});
				registerPagilaDriver(reloaded);

				await vi.waitFor(() => {
					expect(reloaded.getDiscoveredProfiles().map(profile => profile.connectionName))
						.toEqual(['Pagila']);
				});
				expect(reloaded.getProfile('saved-2')?.discoveredFromId).toBeUndefined();
			});
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
				// Saved as a global connection, like any profile saved without a scope.
				scope: 'global',
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

			await expect(service.getDisplayParameterValues(service.getProfile('conn-1')!)).resolves.toEqual({
				connectionString: 'DSN=Pagila;UID=admin;PWD=****',
			});
		});

		it('leaves out a secret the driver reports nothing to redact in, rather than passing it through', async () => {
			registerRedactingDriver([{ id: 'pwd', label: 'Password', type: 'password' }]);
			service.addUpdateProfile({
				...createProfile('conn-1'),
				parameterValues: { dsn: 'Pagila', pwd: 'hunter2' },
			});

			await expect(service.getDisplayParameterValues(service.getProfile('conn-1')!)).resolves.toEqual({ dsn: 'Pagila' });
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

			await expect(service.getDisplayParameterValues(service.getProfile('discovered:test-driver:odbc-dsn:Pagila')!))
				.resolves.toEqual({ dsn: 'Pagila', pwd: 'PWD=****' });
		});

		// Nothing can be redacted without a driver, and passing values through unredacted is what
		// this method exists to avoid, so it stops at what the profile holds in public.
		it('falls back to the profile\'s secret-free values when the driver is unregistered', async () => {
			service.addUpdateProfile({
				...createProfile('conn-1'),
				parameterValues: { connectionString: 'DSN=Pagila;PWD=hunter2' },
			});

			await expect(service.getDisplayParameterValues(service.getProfile('conn-1')!)).resolves.toEqual({
				connectionString: 'DSN=Pagila;PWD=hunter2',
			});
		});

		// The caller passes the profile it is rendering, from a catalog snapshot it took earlier.
		// Discovery refreshes while that snapshot is in flight, so the profile can already be gone
		// by the time this runs; its public values are still what the caller asked to display.
		it('renders a profile that has since left the catalog from the profile it was given', async () => {
			const gone = { ...createProfile('conn-gone'), parameterValues: { dsn: 'Pagila' } };

			await expect(service.getDisplayParameterValues(gone)).resolves.toEqual({ dsn: 'Pagila' });
		});
	});
	describe('revealing a connection in the pane', () => {
		it('hands the request over exactly once', () => {
			service.revealConnection('conn-1');

			// Whichever tree gets there first takes it -- one being built as the pane renders, or
			// one already listening. It has to be cleared on the way out, or every tree built
			// afterwards would re-reveal a connection the user has long since moved on from.
			expect(service.takePendingRevealConnection()).toEqual({ profileId: 'conn-1' });
			expect(service.takePendingRevealConnection()).toBeUndefined();
		});

		it('hands over where in the connection to go, and whether to open the node\'s details', () => {
			const nodePath = [JSON.stringify(['schema', 'ERP_DUMP'])];
			service.revealConnection('conn-1', { nodePath, openDetails: true });

			expect(service.takePendingRevealConnection()).toEqual({ profileId: 'conn-1', nodePath, openDetails: true });
		});

		it('records the request before announcing it', () => {
			// The announcement carries nothing: a listener reads the profile back from the service,
			// so the request has to be recorded by the time the event fires.
			let takenWhileFiring: string | undefined;
			ctx.disposables.add(service.onDidRequestRevealConnection(() => {
				takenWhileFiring = service.takePendingRevealConnection()?.profileId;
			}));

			service.revealConnection('conn-1');

			expect(takenWhileFiring).toBe('conn-1');
		});
	});
	describe('revealNode', () => {
		const PATH = [{ kind: DataConnectionNodeKind.Table, name: 'flights' }];

		/** Connects 'conn-1' through a minimal driver, so it has a live instance to reveal into. */
		async function connectProfile() {
			service.driverManager.registerDriver(stubInterface<IDataConnectionDriver>({
				id: 'test-driver',
				metadata: createDriverMetadata(),
				connect: async () => stubInterface<IDataConnectionHandle>({
					handle: 1,
					disconnect: async () => { },
					release: () => { },
				}),
			}));
			service.addUpdateProfile(createProfile('conn-1'));
			return service.connect('conn-1');
		}

		it('opens the pane and raises the request for a live connection', async () => {
			await connectProfile();
			const raised: unknown[] = [];
			ctx.disposables.add(service.onDidRequestReveal(request => raised.push(request)));

			await service.revealNode({ profileId: 'conn-1', path: PATH });

			expect({ openedViews, raised }).toEqual({
				openedViews: [POSITRON_DATA_CONNECTIONS_VIEW_ID],
				raised: [{ profileId: 'conn-1', path: PATH }],
			});
		});

		it('refuses a profile with no live connection', async () => {
			// Walking to a row fetches each level from the driver, so revealing into a closed
			// connection would open it -- which a click on a link in an editor must not do.
			service.addUpdateProfile(createProfile('conn-1'));
			const raised: unknown[] = [];
			ctx.disposables.add(service.onDidRequestReveal(request => raised.push(request)));

			await service.revealNode({ profileId: 'conn-1', path: PATH });

			expect({ openedViews, raised }).toEqual({ openedViews: [], raised: [] });
		});

		it('holds the request for a pane that was not listening yet', async () => {
			// The pane is rendered by the openView above, so it misses the event; the request waits
			// for it to claim on mount.
			await connectProfile();

			await service.revealNode({ profileId: 'conn-1', path: PATH });

			expect(service.takePendingReveal()).toEqual({ profileId: 'conn-1', path: PATH });
			// Claimed once only, so a later mount does not jump the tree to a stale row.
			expect(service.takePendingReveal()).toBeUndefined();
		});

		it('holds nothing when the reveal was refused', async () => {
			service.addUpdateProfile(createProfile('conn-1'));

			await service.revealNode({ profileId: 'conn-1', path: PATH });

			expect(service.takePendingReveal()).toBeUndefined();
		});
	});

	describe('opening a node in the Data Explorer by its path', () => {
		const nodePath = [JSON.stringify(['group-tables', 'Tables']), JSON.stringify(['table', 'flights'])];

		it('has the registered tree open the node, until the tree goes', async () => {
			const opener = { openInDataExplorer: vi.fn(async (_profileId: string, _nodePath: readonly string[], _name: string) => { }) };
			const registration = service.registerNodeOpener(opener);

			const opened = await service.openNodeInDataExplorer('conn-1', nodePath, 'flights');
			const hadOpener = service.hasNodeOpener();
			registration.dispose();

			expect({ opened, hadOpener, hasOpener: service.hasNodeOpener(), calls: opener.openInDataExplorer.mock.calls })
				.toEqual({ opened: true, hadOpener: true, hasOpener: false, calls: [['conn-1', nodePath, 'flights']] });
		});

		it('waits for a tree that registers a moment later, as a pane opened just now builds its own', async () => {
			const opener = { openInDataExplorer: vi.fn(async (_profileId: string, _nodePath: readonly string[], _name: string) => { }) };

			const opening = service.openNodeInDataExplorer('conn-1', nodePath, 'flights');
			ctx.disposables.add(service.registerNodeOpener(opener));

			expect({ opened: await opening, calls: opener.openInDataExplorer.mock.calls.length }).toEqual({ opened: true, calls: 1 });
		});

		it('gives up when no tree arrives, leaving nothing behind for a tree built later', async () => {
			vi.useFakeTimers();
			try {
				const opening = service.openNodeInDataExplorer('conn-1', nodePath, 'flights');
				await vi.runAllTimersAsync();
				const opened = await opening;

				const opener = { openInDataExplorer: vi.fn(async (_profileId: string, _nodePath: readonly string[], _name: string) => { }) };
				ctx.disposables.add(service.registerNodeOpener(opener));

				expect({ opened, calls: opener.openInDataExplorer.mock.calls.length }).toEqual({ opened: false, calls: 0 });
			} finally {
				vi.useRealTimers();
			}
		});
	});

	describe('profile scope', () => {
		// Where a profile is persisted: which of the two storages holds its key.
		const storedIn = (id: string) => ({
			profile: storageService.get(`positron.dataConnections.profile.${id}`, StorageScope.PROFILE) !== undefined,
			workspace: storageService.get(`positron.dataConnections.profile.${id}`, StorageScope.WORKSPACE) !== undefined,
		});

		// Starts a service against the current storage, as a window start would.
		const startService = () => {
			const started = ctx.instantiationService.createInstance(PositronDataConnectionsService);
			ctx.disposables.add(started);
			return started;
		};

		it('stores a workspace-scoped profile with the workspace, and a global one with the user profile', () => {
			service.addUpdateProfile({ ...createProfile('workspace-1'), scope: 'workspace' });
			service.addUpdateProfile({ ...createProfile('global-1'), scope: 'global' });
			service.addUpdateProfile(createProfile('legacy-1'));

			expect({
				workspace: storedIn('workspace-1'),
				global: storedIn('global-1'),
				legacy: storedIn('legacy-1'),
			}).toEqual({
				workspace: { profile: false, workspace: true },
				global: { profile: true, workspace: false },
				legacy: { profile: true, workspace: false },
			});
		});

		it('spells out the global scope of a profile saved without one', () => {
			service.addUpdateProfile(createProfile('conn-1'));

			expect(service.getProfile('conn-1')?.scope).toBe('global');
		});

		it('moves a profile between storages when its scope changes', () => {
			service.addUpdateProfile({ ...createProfile('conn-1'), scope: 'global' });
			service.addUpdateProfile({ ...createProfile('conn-1'), scope: 'workspace' });
			const afterToWorkspace = storedIn('conn-1');
			service.addUpdateProfile({ ...createProfile('conn-1'), scope: 'global' });

			expect({ afterToWorkspace, afterToGlobal: storedIn('conn-1') }).toEqual({
				afterToWorkspace: { profile: false, workspace: true },
				afterToGlobal: { profile: true, workspace: false },
			});
		});

		it('loads both kinds on the next start, each with its scope', () => {
			service.addUpdateProfile({ ...createProfile('workspace-1'), scope: 'workspace' });
			service.addUpdateProfile(createProfile('global-1'));

			const scopes = Object.fromEntries(startService().getProfiles().map(profile => [profile.id, profile.scope]));

			expect(scopes).toEqual({ 'workspace-1': 'workspace', 'global-1': 'global' });
		});

		it('does not load workspace-scoped profiles in a window with no folder open', () => {
			service.addUpdateProfile({ ...createProfile('workspace-1'), scope: 'workspace' });
			service.addUpdateProfile(createProfile('global-1'));
			workbenchState = WorkbenchState.EMPTY;

			expect(startService().getProfiles().map(profile => profile.id)).toEqual(['global-1']);
		});

		it('saves a workspace-scoped profile as global in a window with no folder open', () => {
			workbenchState = WorkbenchState.EMPTY;

			service.addUpdateProfile({ ...createProfile('conn-1'), scope: 'workspace' });

			expect({ scope: service.getProfile('conn-1')?.scope, storedIn: storedIn('conn-1') }).toEqual({
				scope: 'global',
				storedIn: { profile: true, workspace: false },
			});
		});

		it('loads a profile stored both globally and in the workspace once, as the workspace copy in the global copy\'s place', () => {
			// Another window, holding a stale global copy of conn-2 after this workspace scoped it to
			// itself, wrote the global copy back.
			service.addUpdateProfile(createProfile('conn-1'));
			service.addUpdateProfile({ ...createProfile('conn-2'), connectionName: 'Global copy' });
			service.addUpdateProfile(createProfile('conn-3'));
			storageService.store(
				'positron.dataConnections.profile.conn-2',
				JSON.stringify({ profile: { ...createProfile('conn-2'), connectionName: 'Workspace copy' }, secretParameterIds: [] }),
				StorageScope.WORKSPACE,
				StorageTarget.USER,
			);

			const profiles = startService().getProfiles().map(({ id, connectionName, scope }) => ({ id, connectionName, scope }));

			expect(profiles).toEqual([
				{ id: 'conn-1', connectionName: 'Connection conn-1', scope: 'global' },
				{ id: 'conn-2', connectionName: 'Workspace copy', scope: 'workspace' },
				{ id: 'conn-3', connectionName: 'Connection conn-3', scope: 'global' },
			]);
		});

		it('reads the secrets of a profile stored in both from the workspace copy in use', async () => {
			// The workspace copy records a secret that the stale global copy predates.
			const secretStorage = new TestSecretStorageService();
			ctx.instantiationService.stub(ISecretStorageService, secretStorage);
			await secretStorage.set('positron.dataConnections.secret.conn-1.apiKey', 'sekret');
			const persist = (storageScope: StorageScope, secretParameterIds: string[]) => storageService.store(
				'positron.dataConnections.profile.conn-1',
				JSON.stringify({ profile: { ...createProfile('conn-1'), parameterValues: { host: 'db.example.com' } }, secretParameterIds }),
				storageScope,
				StorageTarget.USER,
			);
			persist(StorageScope.PROFILE, []);
			persist(StorageScope.WORKSPACE, ['apiKey']);

			const profile = await startService().getProfileWithSecrets('conn-1');

			expect(profile?.parameterValues).toEqual({ host: 'db.example.com', apiKey: 'sekret' });
		});

		it('deletes the secrets either copy records when removing a profile stored in both', async () => {
			// The workspace copy records the secret. The stale global copy, written back by a window
			// that never saw the secret recorded, does not.
			const secretStorage = new TestSecretStorageService();
			ctx.instantiationService.stub(ISecretStorageService, secretStorage);
			await secretStorage.set('positron.dataConnections.secret.conn-1.apiKey', 'sekret');
			const persist = (storageScope: StorageScope, secretParameterIds: string[]) => storageService.store(
				'positron.dataConnections.profile.conn-1',
				JSON.stringify({ profile: createProfile('conn-1'), secretParameterIds }),
				storageScope,
				StorageTarget.USER,
			);
			persist(StorageScope.PROFILE, []);
			persist(StorageScope.WORKSPACE, ['apiKey']);

			startService().removeProfile('conn-1');

			expect({ secret: await secretStorage.get('positron.dataConnections.secret.conn-1.apiKey'), storedIn: storedIn('conn-1') })
				.toEqual({ secret: undefined, storedIn: { profile: false, workspace: false } });
		});

		it('removes a workspace-scoped profile from workspace storage', () => {
			service.addUpdateProfile({ ...createProfile('conn-1'), scope: 'workspace' });

			service.removeProfile('conn-1');

			expect(storedIn('conn-1')).toEqual({ profile: false, workspace: false });
		});
	});
});
