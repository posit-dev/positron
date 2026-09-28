/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './tableDataRowHeader.css';

/**
 * TableDataRowHeaderProps interface.
 */
interface TableDataRowHeaderProps {
	unavailable?: boolean;
	value?: string;
}

/**
 * TableDataRowHeader component.
 * @param props A TableDataRowHeaderProps that contains the component properties.
 * @returns The rendered component.
 */
export const TableDataRowHeader = (props: TableDataRowHeaderProps) => {
	// The label isn't known yet -- either the table's shape hasn't been read, or the table is
	// labeled and this label hasn't arrived. Stand in for it with the same placeholder bar the
	// column headers use, so a loading grid reads as loading along both of its edges. The bar
	// stops pulsing once the labels have been asked for and not delivered, because from then on
	// there is no load for it to be reporting.
	if (props.value === undefined) {
		const placeholderClass = props.unavailable ?
			'data-grid-unavailable-placeholder' :
			'data-grid-loading-placeholder';
		return <div className={`${placeholderClass} label-placeholder`} />;
	}

	// Render.
	return (
		<div className='text'>
			{props.value}
		</div>
	);
};
