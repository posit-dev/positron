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
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { CONTAINER_ONLY_KINDS } from '../../../../services/positronDataConnections/common/dataConnectionSchemaSummary.js';
import { useBusyIndicator } from '../../../../../base/browser/positronReactHooks.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { CustomContextMenuItem } from '../../../../browser/positronComponents/customContextMenu/customContextMenuItem.js';
import { CustomContextMenuSeparator } from '../../../../browser/positronComponents/customContextMenu/customContextMenuSeparator.js';
import { CustomContextMenuEntry, showCustomContextMenu } from '../../../../browser/positronComponents/customContextMenu/customContextMenu.js';
import { IDataConnectionHandle } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';
import { IDataConnectionNodeDTO } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDTOs.js';
import { canPreview, openNodeInDataExplorer } from '../classes/dataConnectionNodePreview.js';

/**
 * Maps a node DTO to a codicon name, keying off its kind (and, for columns/fields, whether it
 * is a primary key). The driver-side kind values are free-form, so unknown kinds fall back to a
 * generic 'symbol-misc' icon. As specific kinds become common across drivers, add entries here
 * to upgrade their visual treatment.
 */
export const kindIcon = (dto: Pick<IDataConnectionNodeDTO, 'kind' | 'isPrimaryKey'>): string => {
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

		case 'notice':
			return 'info';

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

		// A semantic view is a model layered over tables, so it gets a hierarchy glyph rather than
		// the plain view icon. Its logical tables reuse the table icons.
		case 'group-semantic-views':
		case 'semantic-view':
			return 'type-hierarchy';

		case 'group-logical-tables':
			return 'positron-db-tables';

		case 'logical-table':
			return 'positron-db-table';

		case 'group-relationships':
		case 'relationship':
			return 'link';

		case 'group-facts':
		case 'fact':
			return 'symbol-constant';

		case 'group-dimensions':
		case 'dimension':
			return 'symbol-field';

		case 'group-time-dimensions':
		case 'time-dimension':
			return 'calendar';

		case 'group-named-filters':
		case 'named-filter':
			return 'filter';

		case 'group-metrics':
		case 'group-derived-metrics':
		case 'metric':
			return 'graph';

		case 'column':
		case 'field':
			return dto.isPrimaryKey ? 'positron-db-column-key' : 'positron-db-column';

		default:
			return 'symbol-misc';
	}
};

interface DataConnectionNodeRowProps {
	dto: IDataConnectionNodeDTO;
	handle: IDataConnectionHandle;

	// The name of the namespace group this node was breadcrumbed into, when it was that group's
	// only child. Shown ahead of the node's own name, matching how a connection row reads its
	// profile and driver as "Bike Share / PostgreSQL".
	labelPrefix?: string;

	// Reloads this node's subtree. Supplied by the tree, which binds it to this row's node id.
	onRefresh: () => void;

	// Opens this node's details editor, in preview mode unless pinned. Supplied by the tree, which
	// binds it to this row and reports any failure itself.
	onOpenDetails: (pinned: boolean) => Promise<void>;

	// Keeps this node's details tab open, taking it out of preview mode, without fetching its details
	// again when the tab is already open. Supplied by the tree.
	onPinDetails: () => Promise<void>;

	// Tells the tree this row is opening its data, so details still on their way for it -- the first
	// click of a double-click starts fetching them -- don't open over the Data Explorer. Supplied by
	// the tree.
	onOpeningDataExplorer: () => void;

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
 * Explorer on double-click and from the "Open in Data Explorer" context-menu action; nodes that can
 * have children offer a "Refresh" action that re-fetches the subtree. Nodes with details open their
 * details editor via "Show Details", and also open it on single-click, in preview mode; a node with
 * details but no preview -- or one whose driver made details its default action -- keeps it open
 * on double-click, the way the Explorer treats a file. Nodes other than groups offer "Copy Name",
 * and "Copy Path" when the driver gave them one.
 */
export const DataConnectionNodeRow = ({ dto, handle, labelPrefix, onMenuOpening, onOpenDetails, onOpeningDataExplorer, onPinDetails, onRefresh, stale }: DataConnectionNodeRowProps) => {
	const { clipboardService, notificationService, positronDataConnectionsService } = usePositronReactServicesContext();
	const rowRef = useRef<HTMLDivElement>(null);
	// A group row labels the rows beneath it rather than naming a thing of its own, and it holds them
	// at its own indent (see wrapDto). Its plural glyph and the indent guide are what tell it apart
	// from the entities below it; the class carries no styling of its own yet, and is here as the
	// seam for a treatment if one is wanted.
	const isGroup = CONTAINER_ONLY_KINDS.has(dto.kind);
	// Opening a preview can take a moment (a driver may download data first). Track it so the row can
	// show a spinner for the duration, matching the tree's busy treatment on expansion. The spinner
	// is gated so a fast source -- a local PostgreSQL answers in a few milliseconds -- doesn't swap
	// the row's icon for a spinner and back again faster than the eye can resolve it.
	const [opening, setOpening] = useState(false);
	// Details are tracked apart from the preview, so a double-click on a previewable node isn't
	// swallowed by the details its first click is still fetching.
	const [openingDetails, setOpeningDetails] = useState(false);
	const showOpeningSpinner = useBusyIndicator(opening || openingDetails);

	const openInDataExplorer = async () => {
		// Ignore a repeat trigger (double-click or context menu) while a preview is already opening.
		if (opening) {
			return;
		}
		setOpening(true);
		onOpeningDataExplorer();
		try {
			await openNodeInDataExplorer(positronDataConnectionsService, notificationService, handle, dto);
		} finally {
			setOpening(false);
		}
	};

	// Whether details are being fetched, and whether a pinned open arrived meanwhile. Refs rather than
	// state: a double-click's handlers run before React re-renders, so state would still read false.
	const detailsOpeningRef = useRef(false);
	const pinWhenOpenedRef = useRef(false);

	const openDetails = async (pinned: boolean) => {
		// A repeat trigger while the details are already opening doesn't fetch again -- but a pinned
		// one (the double-click that follows a click's preview-mode open) is remembered, so the tab
		// the first open lands in is kept rather than left in preview mode.
		if (detailsOpeningRef.current) {
			pinWhenOpenedRef.current ||= pinned;
			return;
		}
		detailsOpeningRef.current = true;
		pinWhenOpenedRef.current = false;
		setOpeningDetails(true);
		try {
			await onOpenDetails(pinned);
			// The tab the first open just landed in holds the freshest details there are, so it is
			// pinned as it is rather than fetched again.
			if (pinWhenOpenedRef.current && !pinned) {
				await onPinDetails();
			}
		} finally {
			detailsOpeningRef.current = false;
			setOpeningDetails(false);
		}
	};

	const onClick = (e: ReactMouseEvent<HTMLDivElement>) => {
		// Only the first click of a double-click opens the details; the double-click itself decides
		// what the second one means. A node with children opens too: clicking a row only selects
		// it -- the twisty is what expands -- so opening its details doesn't compete with browsing.
		if (e.detail === 1 && dto.hasDetails && !stale) {
			void openDetails(false);
		}
	};

	const onDoubleClick = () => {
		if (stale) {
			return;
		}
		// A double-click opens the node: its data when it has data, as a table, view, or column does,
		// whether or not it has details too (its first click has already shown those, in preview
		// mode). A node with only details -- or one whose driver says its details come first, as a
		// semantic view's logical table, whose data is its base table's -- keeps the details tab that
		// first click opened, the way double-clicking a file in the Explorer does.
		if (dto.hasDetails && (!canPreview(dto) || dto.defaultAction === 'details')) {
			void openDetails(true);
		} else if (canPreview(dto)) {
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
		if (canPreview(dto) || dto.hasDetails) {
			if (entries.length > 0) {
				entries.push(new CustomContextMenuSeparator());
			}
			if (dto.hasDetails) {
				entries.push(new CustomContextMenuItem({
					icon: 'info',
					label: localize('positron.dataConnections.showDetails', "Show Details"),
					onSelected: () => { void openDetails(true); },
				}));
			}
			if (canPreview(dto)) {
				entries.push(new CustomContextMenuItem({
					icon: 'table',
					label: localize('positron.dataConnections.openInDataExplorer', "Open in Data Explorer"),
					onSelected: openInDataExplorer,
				}));
			}
		}

		// Copying is offered for nodes that name a thing; a group's name is only a label, and a
		// notice's is a sentence. The path is the driver's, in the form the source accepts, so it
		// pastes straight into a query.
		if (!isGroup && dto.kind !== 'notice') {
			if (entries.length > 0) {
				entries.push(new CustomContextMenuSeparator());
			}
			entries.push(new CustomContextMenuItem({
				icon: 'copy',
				label: localize('positron.dataConnections.copyName', "Copy Name"),
				onSelected: () => { void clipboardService.writeText(dto.name); },
			}));
			if (dto.path !== undefined) {
				const path = dto.path;
				entries.push(new CustomContextMenuItem({
					label: localize('positron.dataConnections.copyPath', "Copy Path"),
					onSelected: () => { void clipboardService.writeText(path); },
				}));
			}
		}

		// Nothing applies to this node (e.g. a group that can't be refreshed), so leave the event alone
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
		// navigation; click, double-click, and right-click are pointer affordances for opening the
		// details editor and the Data Explorer, matching VS Code's tree behavior. Enter is the
		// keyboard counterpart, handled by the tree.
		// eslint-disable-next-line jsx-a11y/no-static-element-interactions
		<div
			ref={rowRef}
			className={positronClassNames('data-connection-node-row', { 'group': isGroup })}
			onClick={onClick}
			onContextMenu={onContextMenu}
			onDoubleClick={onDoubleClick}
		>
			<div className={`codicon ${showOpeningSpinner ? 'codicon-loading codicon-modifier-spin' : `codicon-${kindIcon(dto)}`} data-connection-node-icon`} />
			<div className='data-connection-node-text'>
				{labelPrefix !== undefined && (
					<span className='data-connection-node-prefix'>{labelPrefix}{' · '}</span>
				)}
				<span className='data-connection-node-name'>{dto.name}</span>
			</div>
			{dto.dataType && (
				<div className='data-connection-node-type'>{dto.dataType}</div>
			)}
		</div>
	);
};
