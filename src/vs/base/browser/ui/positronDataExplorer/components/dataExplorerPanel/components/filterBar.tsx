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
const filterButtonAriaLabel = localize('positron.filtering', "Filtering");
const addFilterButtonAriaLabel = localize('positron.addFilter', "Add filter");

// Temporary filter.
interface Filter {
	name: string;
	width: number;
}

/**
 * FilterBar component.
 * @returns The rendered component.
 */
export const FilterBar = () => {
	// Context hooks.
	const context = usePositronDataExplorerContext();

	// Reference hooks.
	const filterButtonRef = useRef<HTMLDivElement>(undefined!);

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
			label: localize('positron.addFilter', "Add filter"),
			icon: 'positron-add-filter',
			onSelected: () => addFilter()
		}));
		entries.push(new ContextMenuSeparator());
		if (!filtersHidden) {
			entries.push(new ContextMenuItem({
				label: localize('positron.hideFilters', "Hide filters"),
				icon: 'positron-hide-filters',
				disabled: filters.length === 0,
				onSelected: () => setFiltersHidden(true)
			}));
		} else {
			entries.push(new ContextMenuItem({
				label: localize('positron.showFilters', "Show filters"),
				icon: 'positron-show-filters',
				onSelected: () => setFiltersHidden(false)
			}));
		}
		entries.push(new ContextMenuSeparator());
		entries.push(new ContextMenuItem({
			label: localize('positron.clearFilters', "Clear filters"),
			icon: 'positron-clear-row-filters',
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
					ariaLabel={filterButtonAriaLabel}
					onPressed={filterButtonPressedHandler}
				>
					<div className='codicon codicon-positron-row-filter' />
					{filters.length !== 0 && <div className='counter'>{filters.length}</div>}
				</PositronButton>
			</div>
			<div className='filter-entries'>
				{!filtersHidden && filters.map(filter =>
					<div className='filter' style={{ width: filter.width }}>{filter.name}</div>
				)}
				<PositronButton
					className='add-filter-button'
					ariaLabel={addFilterButtonAriaLabel}
					onPressed={addFilterButtonPressedHandler}
				>
					<div className='codicon codicon-positron-add-filter' />
				</PositronButton>
			</div>
		</div>
	);
};
