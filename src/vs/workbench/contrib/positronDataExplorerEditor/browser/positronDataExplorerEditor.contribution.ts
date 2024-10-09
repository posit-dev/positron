/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { Schemas } from 'vs/base/common/network';
import { Disposable } from 'vs/base/common/lifecycle';
import { EditorExtensions } from 'vs/workbench/common/editor';
import { Registry } from 'vs/platform/registry/common/platform';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { EditorPaneDescriptor, IEditorPaneRegistry } from 'vs/workbench/browser/editor';
import { WorkbenchPhase, registerWorkbenchContribution2 } from 'vs/workbench/common/contributions';
import { EditorInputFactoryFunction, IEditorResolverService, RegisteredEditorPriority } from 'vs/workbench/services/editor/common/editorResolverService';
import { PositronDataExplorerEditor } from 'vs/workbench/contrib/positronDataExplorerEditor/browser/positronDataExplorerEditor';
import { PositronDataExplorerEditorInput } from 'vs/workbench/contrib/positronDataExplorerEditor/browser/positronDataExplorerEditorInput';
import { registerPositronDataExplorerActions } from 'vs/workbench/contrib/positronDataExplorerEditor/browser/positronDataExplorerActions';
import { extname } from 'vs/base/common/resources';
import { IPositronDataExplorerService } from 'vs/workbench/services/positronDataExplorer/browser/interfaces/positronDataExplorerService';
import { PositronDataExplorerUri } from 'vs/workbench/services/positronDataExplorer/common/positronDataExplorerUri';

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

		const DUCKDB_SUPPORTED_EXTENSIONS = ['parquet', 'parq', 'csv', 'tsv'];

		this._register(editorResolverService.registerEditor(
			`*.{${DUCKDB_SUPPORTED_EXTENSIONS.join(',')}}`,
			editorInfo,
			{
				singlePerResource: true,
				canSupportResource: resource => {
					return DUCKDB_SUPPORTED_EXTENSIONS.includes(extname(resource).substring(1));
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
