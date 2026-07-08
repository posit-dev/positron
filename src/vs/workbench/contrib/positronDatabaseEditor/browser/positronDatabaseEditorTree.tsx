/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { ReactNode } from 'react';

// Other dependencies.
import { DataConnectionNodeRow } from '../../positronDataConnections/browser/components/dataConnectionNodeRow.js';
import { DataConnectionNode, wrapDto } from '../../positronDataConnections/browser/classes/dataConnectionsTreeInstance.js';
import { VisibleNode } from '../../../browser/positronTree/classes/treeNode.js';
import { PositronTreeInstance } from '../../../browser/positronTree/classes/positronTreeInstance.js';
import { IDataConnectionNodeDTO } from '../../../services/positronDataConnections/common/interfaces/dataConnectionDTOs.js';
import { IDataConnectionHandle } from '../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';

/**
 * The row height in pixels. Matches the Data Connections panel so the tree keeps the same visual
 * rhythm.
 */
const ROW_HEIGHT = 24;

/**
 * Called when a previewable node (table/view/column) is activated in the tree.
 */
export type DatabaseTreePreviewHandler = (dto: IDataConnectionNodeDTO, handle: IDataConnectionHandle) => void;

/**
 * SingleConnectionTreeInstance. Backs the database editor's left pane. Renders the schema/tables/
 * views/columns tree for a single already-connected data connection, reusing the Data Connections
 * panel's DTO node walking (wrapDto) and row component (DataConnectionNodeRow). Unlike the panel's
 * tree, it has no profile/entry roots and never connects or disconnects -- the editor owns the
 * connection lifecycle. Preview is routed through onPreview so the editor can host the Data Explorer
 * in its own pane rather than opening a standalone editor.
 */
export class SingleConnectionTreeInstance extends PositronTreeInstance<DataConnectionNode> {
	constructor(handle: IDataConnectionHandle, onPreview: DatabaseTreePreviewHandler) {
		super({
			rowHeight: ROW_HEIGHT,
			indentWidth: 16,
			getRoots: async () => (await handle.getChildren()).map(dto => wrapDto(dto, handle)),
			getChildren: async node => {
				const data = node.data;
				// The single-connection tree only ever produces DTO nodes; entries never occur.
				if (data.kind !== 'dto') {
					return [];
				}
				const dtos = await data.handle.nodeGetChildren(data.dto.nodeHandle);
				return dtos.map(dto => wrapDto(dto, data.handle));
			},
			renderNode: visible => renderNode(visible, onPreview),
		});
	}
}

function renderNode(visible: VisibleNode<DataConnectionNode>, onPreview: DatabaseTreePreviewHandler): ReactNode {
	const data = visible.node.data;
	if (data.kind !== 'dto') {
		return null;
	}
	return <DataConnectionNodeRow dto={data.dto} handle={data.handle} onPreview={onPreview} />;
}
