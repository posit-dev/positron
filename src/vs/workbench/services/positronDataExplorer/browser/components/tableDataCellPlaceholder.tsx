/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './tableDataCellPlaceholder.css';

import { localize } from '../../../../../nls.js';

/**
 * TableDataCellPlaceholderProps interface.
 */
interface TableDataCellPlaceholderProps {
	unavailable?: boolean;
}

/**
 * TableDataCellPlaceholder component. Stands in for a cell whose value hasn't arrived: the table
 * data cache loads the window around the viewport, so a cell can be on screen before its value is,
 * on the first load and again whenever scrolling outruns the data source.
 *
 * A missing value is not the same as an absent one -- a null or an NA arrives as a cell of its own
 * kind and renders as a special value -- so this only ever stands in for one still in flight, or
 * one the last attempt to fetch could not deliver.
 *
 * @param props A TableDataCellPlaceholderProps that contains the component properties.
 * @returns The rendered component.
 */
export const TableDataCellPlaceholder = (props: TableDataCellPlaceholderProps) => {
	// The value isn't coming. The same mark, standing still: a pulse says work is under way, and
	// there is none, so leaving it moving would promise a value that no one is fetching. The label
	// is what carries the meaning for anyone who can't see the difference.
	if (props.unavailable) {
		const unavailable = localize(
			'positron.dataExplorer.cellUnavailable',
			"Value unavailable"
		);

		return (
			<div className='table-data-cell-placeholder'>
				<div
					aria-label={unavailable}
					className='data-grid-unavailable-mark codicon codicon-ellipsis'
					role='img'
					title={unavailable}
				/>
			</div>
		);
	}

	// Render. The mark is the ellipsis the summary panel uses for a value it is still computing,
	// and it is shared with it -- see data-grid-loading-mark -- so the two sides of the Data
	// Explorer agree. It is centered rather than following the column's alignment, because it
	// isn't a value.
	//
	// Two elements because there are two animations that both want the opacity: the container fades
	// the whole thing in once, and the mark inside pulses for as long as it is there. Nesting them
	// multiplies the two rather than letting the later one win.
	return (
		<div className='table-data-cell-placeholder'>
			<div aria-hidden='true' className='data-grid-loading-mark codicon codicon-ellipsis' />
		</div>
	);
};
