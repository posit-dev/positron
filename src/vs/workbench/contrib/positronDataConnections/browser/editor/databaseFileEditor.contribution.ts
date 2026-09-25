/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { URI } from '../../../../../base/common/uri.js';
import { Schemas } from '../../../../../base/common/network.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { extname } from '../../../../../base/common/resources.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { EditorExtensions, IEditorFactoryRegistry, IEditorSerializer } from '../../../../common/editor.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../../browser/editor.js';
import { WorkbenchPhase, registerWorkbenchContribution2 } from '../../../../common/contributions.js';
import { IEditorResolverService, RegisteredEditorPriority } from '../../../../services/editor/common/editorResolverService.js';
import { DatabaseFileEditor } from './databaseFileEditor.js';
import { DatabaseFileEditorInput, IDatabaseFileDriver } from './databaseFileEditorInput.js';
import { POSITRON_DATA_CONNECTIONS_ENABLED_KEY } from '../positronDataConnectionsConfiguration.js';

// The drivers that read a database file, named here rather than discovered: the editor has to
// declare which file extensions it claims before any driver extension has activated (they load
// lazily, when the user first asks for a connection), so the mapping cannot come from the drivers
// themselves. Each extension list mirrors the file filters the driver declares on its own database
// file parameter -- see duckdbDriver.ts and sqliteDriver.ts -- and the names are the drivers' own.
const DUCKDB_DRIVER: IDatabaseFileDriver = { id: 'positron-data-driver-duckdb', name: 'DuckDB' };
const SQLITE_DRIVER: IDatabaseFileDriver = { id: 'positron-data-driver-sqlite', name: 'SQLite' };

// The database file extensions this editor opens, each mapped to the driver that reads it. Keys are
// lowercase and compared that way, since the registration glob below matches case-insensitively.
//
// `db` is the ambiguous one: it is the conventional third extension for SQLite (and the SQLite
// driver offers it in its own file picker), but nothing about the extension guarantees the file is
// a SQLite database. A `.db` file that isn't one still opens to this page, and the connection the
// page offers to create would fail when the driver tries to read it -- which is a clearer outcome
// than the "file is not displayed in the text editor" page it gets otherwise.
const DATABASE_FILE_DRIVERS = new Map<string, IDatabaseFileDriver>([
	['duckdb', DUCKDB_DRIVER],
	['ddb', DUCKDB_DRIVER],
	['sqlite', SQLITE_DRIVER],
	['sqlite3', SQLITE_DRIVER],
	['db', SQLITE_DRIVER],
]);

/**
 * Gets the driver for a resource, if its extension is one this editor claims.
 *
 * The resource has to be a real file on the file system the extension host sees, because that is
 * all a driver can open: it is handed a path, not a URI, and reads it directly. A database file
 * from anywhere else -- a `git:` revision in a diff, say -- is left to the editor it opens in
 * today, since a connection to it could not be made.
 * @param resource The resource.
 * @returns The driver that reads this kind of database file, or undefined if none does.
 */
function driverForResource(resource: URI): IDatabaseFileDriver | undefined {
	if (resource.scheme !== Schemas.file && resource.scheme !== Schemas.vscodeRemote) {
		return undefined;
	}

	// The registration glob matches case-insensitively, so compare case-insensitively here too, or
	// BIKESHARE.DUCKDB resolves to no editor.
	return DATABASE_FILE_DRIVERS.get(extname(resource).substring(1).toLowerCase());
}

/**
 * The serialized form of a database file editor input: the file, and nothing else. The driver is
 * derived from the file again on the way back in, so a restored tab picks up the current mapping
 * rather than one persisted from an older session.
 */
interface ISerializedDatabaseFileEditorInput {
	readonly resource: string;
}

/**
 * DatabaseFileEditorInputSerializer class.
 * Persists open database file tabs across a window reload. Without this, a tab the user opened
 * would silently disappear the next time the window came back.
 */
class DatabaseFileEditorInputSerializer implements IEditorSerializer {
	/**
	 * Determines whether the editor input can be serialized.
	 * @param editorInput The editor input.
	 */
	canSerialize(editorInput: EditorInput): boolean {
		return editorInput instanceof DatabaseFileEditorInput;
	}

	/**
	 * Serializes the editor input.
	 * @param editorInput The editor input.
	 */
	serialize(editorInput: EditorInput): string | undefined {
		if (!(editorInput instanceof DatabaseFileEditorInput)) {
			return undefined;
		}

		const serialized: ISerializedDatabaseFileEditorInput = {
			resource: editorInput.resource.toString(),
		};

		return JSON.stringify(serialized);
	}

	/**
	 * Deserializes the editor input.
	 * @param instantiationService The instantiation service.
	 * @param serializedEditorInput The serialized editor input.
	 */
	deserialize(instantiationService: IInstantiationService, serializedEditorInput: string): EditorInput | undefined {
		let resource: URI;
		try {
			const deserialized: ISerializedDatabaseFileEditorInput = JSON.parse(serializedEditorInput);
			resource = URI.parse(deserialized.resource);
		} catch {
			return undefined;
		}

		// A file this editor no longer claims (the mapping changed under a restored tab) restores
		// as nothing, leaving the workbench to drop the tab rather than open a page for a file the
		// page cannot describe.
		const driver = driverForResource(resource);
		if (!driver) {
			return undefined;
		}

		return instantiationService.createInstance(DatabaseFileEditorInput, resource, driver);
	}
}

/**
 * DatabaseFileEditorContribution class.
 * Registers the database file editor: the pane, and the editor resolver entry that routes database
 * files to it.
 */
class DatabaseFileEditorContribution extends Disposable {
	/**
	 * The identifier.
	 */
	static readonly ID = 'workbench.contrib.positronDatabaseFileEditor';

	/**
	 * Constructor.
	 * @param configurationService The configuration service.
	 * @param editorResolverService The editor resolver service.
	 * @param instantiationService The instantiation service.
	 */
	constructor(
		@IConfigurationService configurationService: IConfigurationService,
		@IEditorResolverService editorResolverService: IEditorResolverService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		// Call the base class's constructor.
		super();

		// The page exists to send the user to the Data Connections pane, so it is gated on the same
		// feature flag that pane is, and read the same way: once, at startup. With the feature off,
		// a database file opens exactly as it does today. Toggling the setting requires a reload.
		if (!configurationService.getValue<boolean>(POSITRON_DATA_CONNECTIONS_ENABLED_KEY)) {
			return;
		}

		// Register the editor input serializer, so open tabs survive a window reload.
		this._register(Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(
			DatabaseFileEditorInput.TypeID,
			DatabaseFileEditorInputSerializer
		));

		// Register the editor pane.
		this._register(Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
			EditorPaneDescriptor.create(
				DatabaseFileEditor,
				DatabaseFileEditorInput.EditorID,
				localize('positron.databaseFileEditor', "Database File Editor")
			),
			[
				new SyncDescriptor(DatabaseFileEditorInput)
			]
		));

		// Register the editor. `builtin` priority puts the page ahead of the binary file editor a
		// database file falls to today, while leaving the user free to pick another editor from
		// Open With (the text editor, to look at the file's bytes).
		this._register(editorResolverService.registerEditor(
			`*.{${[...DATABASE_FILE_DRIVERS.keys()].join(',')}}`,
			{
				id: DatabaseFileEditorInput.EditorID,
				label: localize('positron.databaseFile', "Database File"),
				priority: RegisteredEditorPriority.builtin,
			},
			{
				singlePerResource: true,
				canSupportResource: resource => driverForResource(resource) !== undefined,
			},
			{
				createEditorInput: ({ resource, options }) => {
					// The resolver only reaches here for a resource canSupportResource claimed, so
					// the file always maps to a driver.
					const driver = driverForResource(resource)!;
					return {
						editor: instantiationService.createInstance(DatabaseFileEditorInput, resource, driver),
						options,
					};
				},
			}
		));
	}
}

/**
 * Registers the database file editor.
 */
export function registerDatabaseFileEditor(): void {
	registerWorkbenchContribution2(
		DatabaseFileEditorContribution.ID,
		DatabaseFileEditorContribution,
		WorkbenchPhase.BlockRestore
	);
}
