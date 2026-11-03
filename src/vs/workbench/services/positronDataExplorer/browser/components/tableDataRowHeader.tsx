/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './tableDataRowHeader.css';

// Other dependencies.
import { findMatchSpan, SearchTerm } from '../../common/dataExplorerSearch.js';

/**
 * TableDataRowHeaderProps interface.
 */
interface TableDataRowHeaderProps {
	unavailable?: boolean;
	value?: string;
	search?: SearchTerm;
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

	// Highlight the first occurrence of the search term.
	const match = props.search ? findMatchSpan(props.value, props.search) : undefined;
	const content = !match ? props.value : <>
		{props.value.slice(0, match[0])}
		<mark className='search-match-text'>{props.value.slice(match[0], match[1])}</mark>
		{props.value.slice(match[1])}
	</>;

	// Render.
	return (
		<div className='text'>
			{content}
		</div>
	);
};
