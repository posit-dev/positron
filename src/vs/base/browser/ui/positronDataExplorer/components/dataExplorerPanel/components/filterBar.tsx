/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./filterBar';

// React.
import * as React from 'react';
import { useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { localize } from 'vs/nls';
import { showContextMenu } from 'vs/base/browser/ui/contextMenu/contextMenu';
import { ContextMenuItem } from 'vs/base/browser/ui/contextMenu/contextMenuItem';
import { PositronButton } from 'vs/base/browser/ui/positronComponents/positronButton';
import { ContextMenuSeparator } from 'vs/base/browser/ui/contextMenu/contextMenuSeparator';
import { usePositronDataExplorerContext } from 'vs/base/browser/ui/positronDataExplorer/positronDataExplorerContext';

// Temporary filter.
interface Filter {
	name: string;
	width: number;
}

/**
 * FilterBarProps interface.
 */
interface FilterBarProps {
	type: 'column' | 'row';
}

/**
 * FilterBar component.
 * @returns The rendered component.
 */
export const FilterBar = (props: FilterBarProps) => {
	// Context hooks.
	const context = usePositronDataExplorerContext();

	// Reference hooks.
	const filterButtonRef = useRef<HTMLDivElement>(undefined!);

	// State hooks.
	const [resources] = React.useState<{
		filterTypeLabel: string;
		filterButtonIconId: string;
		filterButtonAriaLabel: string;
		addFilterButtonIconId: string;
		addFilterButtonAriaLabel: string;
		clearFiltersIconId: string;
	}>(() => {
		if (props.type === 'column') {
			return {
				filterTypeLabel: localize('positron.column', "column"),
				filterButtonIconId: 'positron-column-filter',
				filterButtonAriaLabel: localize('positron.columnFiltering', "Column filtering"),
				addFilterButtonIconId: 'positron-add-filter',
				addFilterButtonAriaLabel: localize('positron.addColumnFilter', "Add column filter"),
				clearFiltersIconId: 'positron-clear-column-filters',
			};
		} else if (props.type === 'row') {
			return {
				filterTypeLabel: localize('positron.row', "row"),
				filterButtonIconId: 'positron-row-filter',
				filterButtonAriaLabel: localize('positron.rowFiltering', "Row filtering"),
				addFilterButtonIconId: 'positron-add-filter',
				addFilterButtonAriaLabel: localize('positron.addRowFilter', "Add row filter"),
				clearFiltersIconId: 'positron-clear-row-filters',
			};
		} else {
			// Can't happen.
			throw new Error('Unexpected filter bar type');
		}
	});

	// Temporary state code.
	const [filters, setFilters] = useState<Filter[]>([]);
	const [filtersHidden, setFiltersHidden] = useState(false);

	/**
	 * Filter button pressed handler.
	 */
	const filterButtonPressedHandler = async () => {
		// Build the context menu entries.
		const entries: (ContextMenuItem | ContextMenuSeparator)[] = [];
		entries.push(new ContextMenuItem({
			label: localize(
				'positron.addFilter',
				"Add {0} filter",
				resources.filterTypeLabel
			),
			icon: resources.addFilterButtonIconId,
			onSelected: () => addFilter()
		}));
		entries.push(new ContextMenuSeparator());
		if (!filtersHidden) {
			entries.push(new ContextMenuItem({
				label: localize(
					'positron.hideFilters',
					"Hide {0} filters",
					resources.filterTypeLabel
				),
				icon: 'positron-hide-filters',
				disabled: filters.length === 0,
				onSelected: () => setFiltersHidden(true)
			}));
		} else {
			entries.push(new ContextMenuItem({
				label: localize(
					'positron.showFilters',
					"Show {0} filters",
					resources.filterTypeLabel
				),
				icon: 'positron-show-filters',
				onSelected: () => setFiltersHidden(false)
			}));
		}
		entries.push(new ContextMenuSeparator());
		entries.push(new ContextMenuItem({
			label: localize(
				'positron.clearFilters',
				"Clear all {0} filters",
				resources.filterTypeLabel
			),
			icon: resources.clearFiltersIconId,
			disabled: filters.length === 0,
			onSelected: () => setFilters([])
		}));

		// Show the context menu.
		await showContextMenu({
			layoutService: context.layoutService,
			anchorElement: filterButtonRef.current,
			alignment: 'left',
			width: 200,
			entries
		});
	};

	/**
	 * Add filter button pressed handler.
	 */
	const addFilterButtonPressedHandler = () => {
		addFilter();
	};

	// Temporary code.
	const addFilter = () => {
		const width = Math.floor(Math.random() * 120) + 80;
		setFilters(filters => [...filters, { name: `Filter ${filters.length + 1}`, width }]);
		setFiltersHidden(false);
	};

	// Render.
	return (
		<div className='filter-bar'>
			<div className='filter'>
				<PositronButton
					ref={filterButtonRef}
					className='filter-button'
					ariaLabel={resources.filterButtonAriaLabel}
					onPressed={filterButtonPressedHandler}
				>
					<div className={`codicon codicon-${resources.filterButtonIconId}`} />
					{filters.length !== 0 && <div className='counter'>{filters.length}</div>}
				</PositronButton>
			</div>
			<div className='filter-entries'>
				{!filtersHidden && filters.map(filter =>
					<div className='filter' style={{ width: filter.width }}>{filter.name}</div>
				)}
				<PositronButton
					className='add-filter-button'
					ariaLabel={resources.addFilterButtonIconId}
					onPressed={addFilterButtonPressedHandler}
				>
					<div className={`codicon codicon-${resources.addFilterButtonIconId}`} />
				</PositronButton>
			</div>
		</div>
	);
};
