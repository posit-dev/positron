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

/**
 * Localized strings.
 */
// const sortAscendingTitle = localize('positron.sortAscending', "Sort Ascending");
// const sortDescendingTitle = localize('positron.sortDescending', "Sort Descending");
// const clearSortingTitle = localize('positron.clearSorting', "Clear Sorting");
// const copyColumnTitle = localize('positron.copyColumn', "Copy Column");

/**
 * FilterBarProps interface.
 */
interface FilterBarProps {
	filterTypeLabel: string;
	filterTypeIconId: string;
	filterTypeAriaLabel: string;
}

// Temporary code.
interface Filter {
	name: string;
	width: number;
}

/**
 * FilterBar component.
 * @returns The rendered component.
 */
export const FilterBar = (props: FilterBarProps) => {
	// Context hooks.
	const context = usePositronDataExplorerContext();
	console.log(context.instance.layout);

	// Reference hooks.
	const filterButtonRef = useRef<HTMLDivElement>(undefined!);

	// State hooks.
	const [filters, setFilters] = useState<Filter[]>([]);
	const [filtersHidden, setFiltersHidden] = useState(false);

	/**
	 * Filter button pressed handler.
	 */
	const filterButtonPressedHandler = async () => {
		// Build the context menu entries.
		const entries: (ContextMenuItem | ContextMenuSeparator)[] = [];
		entries.push(new ContextMenuItem({
			label: localize('positron.addFilter', "Add {0} filter", props.filterTypeLabel),
			icon: 'positron-add-filter',
			onSelected: () => addFilter()
		}));
		entries.push(new ContextMenuSeparator());
		if (!filtersHidden) {
			entries.push(new ContextMenuItem({
				label: localize('positron.hideFilters', "Hide {0} filters", props.filterTypeLabel),
				icon: 'arrow-up',
				disabled: filters.length === 0,
				onSelected: () => setFiltersHidden(true)
			}));
		} else {
			entries.push(new ContextMenuItem({
				label: localize('positron.showFilters', "Show {0} filters", props.filterTypeLabel),
				icon: 'arrow-up',
				onSelected: () => setFiltersHidden(false)
			}));
		}
		entries.push(new ContextMenuSeparator());
		entries.push(new ContextMenuItem({
			label: localize('positron.clearFilters', "Clear all {0} filters", props.filterTypeLabel),
			icon: 'arrow-up',
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

	const addFilter = () => {
		// Temporary code.
		const width = Math.floor(Math.random() * 120) + 80;
		setFilters(filters => [...filters, { name: `Filter ${filters.length + 1}`, width }]);
	};

	// Render.
	return (
		<div className='filter-bar'>
			<div className='filter'>
				<PositronButton
					ref={filterButtonRef}
					className='filter-button'
					ariaLabel={props.filterTypeAriaLabel}
					onPressed={filterButtonPressedHandler}
				>
					<div className={`codicon codicon-${props.filterTypeIconId}`} />
				</PositronButton>
			</div>
			<div className='filter-entries'>
				{filters.map(filter =>
					<div className='filter' style={{ width: filter.width }}>{filter.name}</div>
				)}
				<PositronButton
					className='add-filter-button'
					ariaLabel={props.filterTypeAriaLabel}
					onPressed={addFilterButtonPressedHandler}
				>
					<div className={`codicon codicon-positron-add-filter`} />
				</PositronButton>
			</div>
		</div>
	);
};
