/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { URI } from '../../../../base/common/uri.js';
import { extname } from '../../../../base/common/resources.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { EditorExtensions } from '../../../common/editor.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { IEditorResolverService, RegisteredEditorPriority } from '../../../services/editor/common/editorResolverService.js';
import { PositronDatabaseEditor } from './positronDatabaseEditor.js';
import { PositronDatabaseEditorInput } from './positronDatabaseEditorInput.js';

/**
 * File extensions the database editor claims, mapped to the driver that opens them.
 */
const DUCKDB_EXTENSIONS = ['duckdb', 'ddb'];
const SQLITE_EXTENSIONS = ['sqlite', 'sqlite3', 'db'];
const DATABASE_EXTENSIONS = [...DUCKDB_EXTENSIONS, ...SQLITE_EXTENSIONS];

const DUCKDB_DRIVER_ID = 'positron-data-driver-duckdb';
const SQLITE_DRIVER_ID = 'positron-data-driver-sqlite';

/**
 * Returns the lowercased extension (without the dot) of a resource.
 */
function fileExtension(resource: URI): string {
	return extname(resource).substring(1).toLowerCase();
}

/**
 * Picks the data connection driver id for a database file, by extension.
 */
function driverIdForResource(resource: URI): string {
	return DUCKDB_EXTENSIONS.includes(fileExtension(resource)) ? DUCKDB_DRIVER_ID : SQLITE_DRIVER_ID;
}

/**
 * PositronDatabaseEditorContribution. Routes double-clicking a database file (DuckDB / SQLite) in
 * the Explorer to the Positron database editor instead of the binary-file placeholder.
 */
class PositronDatabaseEditorContribution extends Disposable {
	static readonly ID = 'workbench.contrib.positronDatabaseEditor';

	constructor(
		@IEditorResolverService editorResolverService: IEditorResolverService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();

		const editorInfo = {
			id: PositronDatabaseEditorInput.EditorID,
			label: localize('positronDatabaseEditor', "Positron Database Editor"),
			priority: RegisteredEditorPriority.builtin
		};

		this._register(editorResolverService.registerEditor(
			`*.{${DATABASE_EXTENSIONS.join(',')}}`,
			editorInfo,
			{
				singlePerResource: true,
				canSupportResource: resource => DATABASE_EXTENSIONS.includes(fileExtension(resource))
			},
			{
				createEditorInput: ({ resource, options }) => ({
					editor: instantiationService.createInstance(
						PositronDatabaseEditorInput,
						resource,
						driverIdForResource(resource)
					),
					options
				})
			}
		));
	}
}

// Register the Positron database editor pane.
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		PositronDatabaseEditor,
		PositronDatabaseEditorInput.EditorID,
		localize('positronDatabaseEditor', "Positron Database Editor")
	),
	[
		new SyncDescriptor(PositronDatabaseEditorInput)
	]
);

// Register the workbench contribution that wires up the editor resolver.
registerWorkbenchContribution2(
	PositronDatabaseEditorContribution.ID,
	PositronDatabaseEditorContribution,
	WorkbenchPhase.BlockRestore
);
