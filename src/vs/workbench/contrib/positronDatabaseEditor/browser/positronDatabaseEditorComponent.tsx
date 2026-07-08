/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useEffect, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../nls.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';
import { PositronTree } from '../../../browser/positronTree/positronTree.js';
import { PositronDataExplorer } from '../../../browser/positronDataExplorer/positronDataExplorer.js';
import { IPositronDataExplorerInstance } from '../../../services/positronDataExplorer/browser/interfaces/positronDataExplorerInstance.js';
import { IDataConnectionInstance } from '../../../services/positronDataConnections/common/interfaces/dataConnectionInstance.js';
import { SingleConnectionTreeInstance } from './positronDatabaseEditorTree.js';

/**
 * PositronDatabaseEditorComponentProps interface.
 */
interface PositronDatabaseEditorComponentProps {
	/** The live connection whose schema tree is browsed on the left. */
	readonly instance: IDataConnectionInstance;
}

/**
 * PositronDatabaseEditorComponent. The database editor's split view: a single-connection schema
 * tree on the left, and a Data Explorer for the selected table/view/column on the right. Selecting
 * a previewable node prepares its Data Explorer via the connection's driver and mounts it in the
 * right pane (rather than opening a standalone Data Explorer editor).
 */
export const PositronDatabaseEditorComponent = ({ instance }: PositronDatabaseEditorComponentProps) => {
	const services = usePositronReactServicesContext();

	// The Data Explorer instance currently shown on the right, if any.
	const [explorerInstance, setExplorerInstance] = useState<IPositronDataExplorerInstance | undefined>(undefined);

	// The single-connection tree. Constructed once per mount; the editor recreates this component
	// (fresh React root) when the input changes, so the connection handle stays in sync.
	const [treeInstance] = useState(() => new SingleConnectionTreeInstance(
		instance.connectionHandle,
		(dto, handle) => {
			handle.nodePreparePreview(dto.nodeHandle).then(target => {
				setExplorerInstance(services.positronDataExplorerService.ensureExtensionBackendInstance(target));
			}).catch(error => {
				services.notificationService.error(localize(
					'positron.databaseEditor.previewFailed',
					"Could not open '{0}': {1}",
					dto.name,
					error instanceof Error ? error.message : String(error)
				));
			});
		}
	));
	useEffect(() => () => treeInstance.dispose(), [treeInstance]);

	// Mark the shown Data Explorer instance visible while it is mounted, so it fetches and renders.
	useEffect(() => {
		if (!explorerInstance) {
			return;
		}
		explorerInstance.setVisible(true);
		return () => explorerInstance.setVisible(false);
	}, [explorerInstance]);

	// Render.
	return (
		<div className='positron-database-editor'>
			<div className='positron-database-editor-tree'>
				<PositronTree
					emptyTreeRenderer={() =>
						<div className='positron-database-editor-empty-tree'>
							{localize('positron.databaseEditor.noObjects', "No database objects.")}
						</div>
					}
					instance={treeInstance}
				/>
			</div>
			<div className='positron-database-editor-explorer'>
				{explorerInstance
					? <PositronDataExplorer instance={explorerInstance} onClose={() => setExplorerInstance(undefined)} />
					: <div className='positron-database-editor-placeholder'>
						{localize('positron.databaseEditor.selectObject', "Select a table or view to preview its data.")}
					</div>
				}
			</div>
		</div>
	);
};
