/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { ChangeEvent } from 'react';

import './summaryRowFilterInput.css';

import { localize } from '../../../../../../../nls.js';

export const SummaryRowFilterInput = ({ searchText, onSearchTextChanged }: SummaryRowFilterInputProps) => {
	return (
		<div className='summary-row-filter-input-container'>
			<input
				className='summary-row-filter-input'
				placeholder={localize('dataExplorer.summaryRowFilter.search.placeholder', "Search...")}
				type='text'
			/>
		</div>

	);
}
