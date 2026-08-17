/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './dataConnectionNodeRow.css';

// React.
import { MouseEvent as ReactMouseEvent, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { CustomContextMenuItem } from '../../../../browser/positronComponents/customContextMenu/customContextMenuItem.js';
import { CustomContextMenuSeparator } from '../../../../browser/positronComponents/customContextMenu/customContextMenuSeparator.js';
import { CustomContextMenuEntry, showCustomContextMenu } from '../../../../browser/positronComponents/customContextMenu/customContextMenu.js';
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

		// No dedicated plural glyph exists, so the "Databases" and "Catalogs" groups reuse the
		// database icon.
		case 'group-databases':
		case 'group-catalogs':
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

		// No dedicated stage or volume glyph yet; reuse the built-in 'archive' icon for these groups and
		// their leaves, since both a stage and a volume are governed file-storage locations.
		case 'group-stages':
		case 'stage':
		case 'group-volumes':
		case 'volume':
			return 'archive';

		// A volume's contents are ordinary files and folders.
		case 'directory':
			return 'folder';

		case 'file':
			return 'file';

		case 'schema':
			return 'positron-db-schema';

		case 'table':
			return 'positron-db-table';

		case 'index':
			return 'positron-db-index';

		case 'view':
			return 'positron-db-view';

		case 'owner':
			return 'account';

		case 'pin':
			return 'pinned';

		case 'version':
			return 'history';

		case 'column':
		case 'field':
			return dto.isPrimaryKey ? 'positron-db-column-key' : 'positron-db-column';

		default:
			return 'symbol-misc';
	}
};

/**
 * Whether a node can be opened in the Data Explorer: a previewable table, view, column, pin, or pin
 * version. The `hasPreview` gate excludes nodes the driver didn't make previewable (e.g. index-column
 * fields, or pins whose storage type isn't tabular).
 */
const canPreview = (dto: IDataConnectionNodeDTO): boolean =>
	dto.hasPreview && (dto.kind === 'table' || dto.kind === 'view' || dto.kind === 'field' || dto.kind === 'pin' || dto.kind === 'version');

interface DataConnectionNodeRowProps {
	dto: IDataConnectionNodeDTO;
	handle: IDataConnectionHandle;

	// Reloads this node's subtree. Supplied by the tree, which binds it to this row's node id.
	onRefresh: () => void;

	// Tells the tree this row is opening a context menu, so it can select the row and hold its
	// focused appearance. Dispose the returned handle when the menu closes.
	onMenuOpening: () => IDisposable;

	// Whether an ancestor is being refreshed, so this row is about to be replaced. The node handle
	// it holds may already be dead -- a connection-level refresh releases every node handle it
	// issued -- so no action is offered until the replacement lands.
	stale: boolean;
}

/**
 * DataConnectionNodeRow component. Renders one server-side connection node (catalog, schema,
 * table, view, column, etc.) inside the tree. Previewable table/view nodes open in the Data
 * Explorer on double-click or via the "Open in Data Explorer" context-menu action; nodes that
 * can have children offer a "Refresh" action that re-fetches the subtree.
 */
export const DataConnectionNodeRow = ({ dto, handle, onMenuOpening, onRefresh, stale }: DataConnectionNodeRowProps) => {
	const { notificationService, positronDataConnectionsService } = usePositronReactServicesContext();
	const rowRef = useRef<HTMLDivElement>(null);
	// Opening a preview can take a moment (a driver may download data first). Track it so the row can
	// show a spinner for the duration, matching the tree's busy treatment on expansion.
	const [opening, setOpening] = useState(false);

	const openInDataExplorer = async () => {
		// Ignore a repeat trigger (double-click or context menu) while a preview is already opening.
		if (opening) {
			return;
		}
		setOpening(true);
		try {
			// Preview through the service rather than the handle so the Data Explorer this opens is
			// recorded against the connection; collapsing the connection consults that record before
			// deciding whether it can be closed.
			await positronDataConnectionsService.previewNode(handle, dto.nodeHandle);
		} catch (error) {
			notificationService.error(localize(
				'positron.dataConnections.openInDataExplorerFailed',
				"Could not open '{0}' in the Data Explorer: {1}",
				dto.name,
				error instanceof Error ? error.message : String(error)
			));
		} finally {
			setOpening(false);
		}
	};

	const onDoubleClick = () => {
		if (canPreview(dto) && !stale) {
			openInDataExplorer();
		}
	};

	const onContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
		if (!rowRef.current) {
			return;
		}

		// An ancestor is refreshing, so this row is on its way out and its handle may already be
		// dead. Offer nothing until the replacement arrives; the ancestor's spinner is the signal.
		if (stale) {
			return;
		}

		// Build the entries that apply to this node. Refresh leads, offered for any node that can
		// have children, expanded or not -- a leaf is the only case with nothing to re-fetch.
		// Preview follows for previewable nodes, separated from Refresh when both are present.
		const entries: CustomContextMenuEntry[] = [];
		if (dto.hasGetChildren) {
			entries.push(new CustomContextMenuItem({
				icon: 'refresh',
				label: localize('positron.dataConnections.refresh', "Refresh"),
				onSelected: onRefresh,
			}));
		}
		if (canPreview(dto)) {
			if (entries.length > 0) {
				entries.push(new CustomContextMenuSeparator());
			}
			entries.push(new CustomContextMenuItem({
				icon: 'table',
				label: localize('positron.dataConnections.openInDataExplorer', "Open in Data Explorer"),
				onSelected: openInDataExplorer,
			}));
		}

		// Nothing applies to this node (e.g. a non-previewable leaf), so leave the event alone
		// rather than swallowing it to show an empty menu.
		if (entries.length === 0) {
			return;
		}

		e.preventDefault();
		e.stopPropagation();

		// Announced before the menu shows so the row is already selected and the tree still reads
		// as focused when the menu paints over it.
		const menuHold = onMenuOpening();
		showCustomContextMenu({
			anchorElement: rowRef.current,
			// Anchored to the pointer rather than the row, so the menu opens where the user
			// clicked instead of snapping to the row's edge.
			anchorPoint: { clientX: e.clientX, clientY: e.clientY },
			popupPosition: 'auto',
			popupAlignment: 'auto',
			width: 'auto',
			entries,
			onClose: () => menuHold.dispose(),
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
			<div className={`codicon ${opening ? 'codicon-loading codicon-modifier-spin' : `codicon-${kindIcon(dto)}`} data-connection-node-icon`} />
			<div className='data-connection-node-text'>{dto.name}</div>
			{dto.dataType && (
				<div className='data-connection-node-type'>{dto.dataType}</div>
			)}
		</div>
	);
};
