/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { ChangeEvent } from 'react';

import './summaryRowFilterInput.css';

import { localize } from '../../../../../../../nls.js';

interface SummaryRowFilterInputProps {
	/**
	 * The current search text.
	 */
	searchText: string;

	/**
	 * Callback when the search text changes.
	 */
	onSearchTextChanged: (value: string) => void;
}

export const SummaryRowFilterInput = ({ searchText, onSearchTextChanged }: SummaryRowFilterInputProps) => {
	const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
		onSearchTextChanged(e.target.value);
	};

	return (
		<div className='summary-row-filter-input-container'>
			<input
				className='summary-row-filter-input'
				placeholder={localize('dataExplorer.summaryRowFilter.search.placeholder', "Search...")}
				type='text'
				value={searchText}
				onChange={handleChange}
			/>
		</div>

	);
}
