/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Schemas } from '../../../../base/common/network.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { EditorExtensions } from '../../../common/editor.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { EditorInputFactoryFunction, IEditorResolverService, RegisteredEditorPriority } from '../../../services/editor/common/editorResolverService.js';
import { PositronDataExplorerEditor } from './positronDataExplorerEditor.js';
import { PositronDataExplorerEditorInput } from './positronDataExplorerEditorInput.js';
import { registerPositronDataExplorerActions } from './positronDataExplorerActions.js';
import { extname } from '../../../../base/common/resources.js';
import { posix } from '../../../../base/common/path.js';
import { IPositronDataExplorerService } from '../../../services/positronDataExplorer/browser/interfaces/positronDataExplorerService.js';
import { PositronDataExplorerUri } from '../../../services/positronDataExplorer/common/positronDataExplorerUri.js';

/**
 * PositronDataExplorerContribution class.
 */
class PositronDataExplorerContribution extends Disposable {
	/**
	 * The identifier.
	 */
	static readonly ID = 'workbench.contrib.positronDataExplorer';

	/**
	 * Constructor.
	 * @param editorResolverService The editor resolver service.
	 * @param instantiationService The instantiation service.
	 */
	constructor(
		@IEditorResolverService editorResolverService: IEditorResolverService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IPositronDataExplorerService dataExplorerService: IPositronDataExplorerService
	) {
		// Call the base class's constructor.
		super();

		const editorInfo = {
			id: PositronDataExplorerEditorInput.EditorID,
			// Label will be overwritten elsewhere
			label: localize('positronDataExplorer', "Positron Data Explorer"),
			priority: RegisteredEditorPriority.builtin
		};

		const createDataExplorerEditor: EditorInputFactoryFunction = ({ resource, options }) => {
			return {
				editor: instantiationService.createInstance(
					PositronDataExplorerEditorInput,
					resource
				),
				options: {
					...options,
					// Fix for https://github.com/posit-dev/positron/issues/3362.
					pinned: true
				}
			};
		};

		// Register the editor.
		this._register(editorResolverService.registerEditor(
			`${Schemas.positronDataExplorer}:**/**`,
			editorInfo,
			{
				singlePerResource: true,
				canSupportResource: resource => resource.scheme === Schemas.positronDataExplorer
			},
			{
				createEditorInput: createDataExplorerEditor
			}
		));

		const DUCKDB_SUPPORTED_EXTENSIONS = ['parquet', 'parq', 'csv', 'tsv', 'gz'];

		this._register(editorResolverService.registerEditor(
			`*.{${DUCKDB_SUPPORTED_EXTENSIONS.join(',')}}`,
			editorInfo,
			{
				singlePerResource: true,
				canSupportResource: resource => {
					let fileExt = extname(resource).substring(1);
					if (fileExt === 'gz') {
						// Strip the .gz and get the actual extension
						fileExt = posix.extname(resource.path.slice(0, -3)).substring(1);
					}
					return DUCKDB_SUPPORTED_EXTENSIONS.includes(fileExt);
				}
			},
			{
				createEditorInput: async ({ resource, options }, group) => {
					await dataExplorerService.openWithDuckDB(resource.path);

					// We create a data explorer URI that will use the DuckDB client
					// that we just created.
					const newResource = PositronDataExplorerUri.generate(`duckdb:${resource.path}`);
					return createDataExplorerEditor({
						resource: newResource,
						options
					}, group);
				}
			}
		));
	}
}

// Register the Positron data explorer editor pane.
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		PositronDataExplorerEditor,
		PositronDataExplorerEditorInput.EditorID,
		localize('positronDataExplorerEditor', "Positron Data Explorer Editor")
	),
	[
		new SyncDescriptor(PositronDataExplorerEditorInput)
	]
);

// Register workbench contribution.
registerWorkbenchContribution2(
	PositronDataExplorerContribution.ID,
	PositronDataExplorerContribution,
	WorkbenchPhase.BlockRestore
);

// Register actions.
registerPositronDataExplorerActions();
