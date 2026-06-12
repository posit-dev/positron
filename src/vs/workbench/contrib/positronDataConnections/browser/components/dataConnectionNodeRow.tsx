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
 * Maps a DTO kind string to a codicon name. The driver-side kind values are free-form, so
 * unknown kinds fall back to a generic 'symbol-misc' icon. As specific kinds become common
 * across drivers, add entries here to upgrade their visual treatment.
 */
const kindIcon = (kind: string): string => {
	switch (kind) {
		case 'catalog':
		case 'database':
			return 'database';
		case 'schema':
			return 'symbol-namespace';
		case 'table':
			return 'table';
		case 'view':
			return 'eye';
		case 'column':
		case 'field':
			return 'symbol-field';
		case 'group-schemas':
			return 'symbol-namespace';
		case 'group-tables':
			return 'table';
		case 'group-views':
			return 'eye';
		case 'group-columns':
			return 'symbol-field';
		case 'group-indexes':
			return 'key';
		case 'group-triggers':
			return 'zap';
		case 'trigger':
			return 'zap';
		case 'index':
			return 'key';
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
			<div className={`codicon codicon-${kindIcon(dto.kind)} data-connection-node-icon`} />
			<div className='data-connection-node-text'>{dto.name}</div>
			{dto.dataType && (
				<div className='data-connection-node-type'>{dto.dataType}</div>
			)}
		</div>
	);
};
