/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './dataConnectionNodeRow.css';

// React.
import { MouseEvent as ReactMouseEvent, useRef } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { showCustomContextMenu } from '../../../../browser/positronComponents/customContextMenu/customContextMenu.js';
import { CustomContextMenuItem } from '../../../../browser/positronComponents/customContextMenu/customContextMenuItem.js';
import { IDataConnectionHandle } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';
import { IDataConnectionNodeDTO } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDTOs.js';

/**
 * Maps a node DTO to a codicon name, keying off its kind (and, for columns/fields, whether it
 * is a primary key). The driver-side kind values are free-form, so unknown kinds fall back to a
 * generic 'symbol-misc' icon. As specific kinds become common across drivers, add entries here
 * to upgrade their visual treatment.
 */
const kindIcon = (dto: IDataConnectionNodeDTO): string => {
	switch (dto.kind) {
		case 'catalog':
		case 'database':
			return 'positron-db-database';

		// No dedicated plural glyph exists, so the "Databases" group reuses the database icon.
		case 'group-databases':
			return 'positron-db-database';

		case 'group-schemas':
			return 'positron-db-schemas';

		case 'group-tables':
			return 'positron-db-tables';

		case 'group-indexes':
			return 'positron-db-indexes';

		case 'group-views':
			return 'positron-db-views';

		case 'group-columns':
			return 'positron-db-columns';

		case 'schema':
			return 'positron-db-schema';

		case 'table':
			return 'positron-db-table';

		case 'index':
			return 'positron-db-index';

		case 'view':
			return 'positron-db-view';

		case 'column':
		case 'field':
			return dto.isPrimaryKey ? 'positron-db-column-key' : 'positron-db-column';

		default:
			return 'symbol-misc';
	}
};

/**
 * Whether a node can be opened in the Data Explorer: a previewable table, view, or column. The
 * `hasPreview` gate excludes nodes the driver didn't make previewable (e.g. index-column fields).
 */
const canPreview = (dto: IDataConnectionNodeDTO): boolean =>
	dto.hasPreview && (dto.kind === 'table' || dto.kind === 'view' || dto.kind === 'field');

interface DataConnectionNodeRowProps {
	dto: IDataConnectionNodeDTO;
	handle: IDataConnectionHandle;
}

/**
 * DataConnectionNodeRow component. Renders one server-side connection node (catalog, schema,
 * table, view, column, etc.) inside the tree. Previewable table/view nodes open in the Data
 * Explorer on double-click or via the "Open in Data Explorer" context-menu action.
 */
export const DataConnectionNodeRow = ({ dto, handle }: DataConnectionNodeRowProps) => {
	const { notificationService } = usePositronReactServicesContext();
	const rowRef = useRef<HTMLDivElement>(null);

	const openInDataExplorer = () => {
		handle.nodePreview(dto.nodeHandle).catch(error => {
			notificationService.error(localize(
				'positron.dataConnections.openInDataExplorerFailed',
				"Could not open '{0}' in the Data Explorer: {1}",
				dto.name,
				error instanceof Error ? error.message : String(error)
			));
		});
	};

	const onDoubleClick = () => {
		if (canPreview(dto)) {
			openInDataExplorer();
		}
	};

	const onContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
		if (!canPreview(dto) || !rowRef.current) {
			return;
		}
		e.preventDefault();
		e.stopPropagation();
		showCustomContextMenu({
			anchorElement: rowRef.current,
			popupPosition: 'auto',
			popupAlignment: 'auto',
			width: 'auto',
			entries: [
				new CustomContextMenuItem({
					icon: 'table',
					label: localize('positron.dataConnections.openInDataExplorer', "Open in Data Explorer"),
					onSelected: openInDataExplorer,
				}),
			],
		});
	};

	return (
		// The row is a presentational element inside a tree that owns focus and keyboard
		// navigation; double-click and right-click are pointer affordances for opening the
		// Data Explorer, matching VS Code's tree behavior.
		// eslint-disable-next-line jsx-a11y/no-static-element-interactions
		<div
			ref={rowRef}
			className='data-connection-node-row'
			onContextMenu={onContextMenu}
			onDoubleClick={onDoubleClick}
		>
			<div className={`codicon codicon-${kindIcon(dto)} data-connection-node-icon`} />
			<div className='data-connection-node-text'>{dto.name}</div>
			{dto.dataType && (
				<div className='data-connection-node-type'>{dto.dataType}</div>
			)}
		</div>
	);
};
