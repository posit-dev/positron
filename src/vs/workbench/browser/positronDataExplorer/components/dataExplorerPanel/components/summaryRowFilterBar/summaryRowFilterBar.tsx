/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './summaryRowFilterBar.css';

import React, { useState } from 'react';

import { SummaryRowSortDropdown } from './summaryRowSortDropdown.js';
import { SummaryRowFilterInput } from './summaryRowFilterInput.js';
import { TableSummaryDataGridInstance } from '../../../../../../services/positronDataExplorer/browser/tableSummaryDataGridInstance.js';

export interface SummaryRowFilterBarProps {
	instance: TableSummaryDataGridInstance
}

export const SummaryRowFilterBar = ({ instance }: SummaryRowFilterBarProps) => {
	return (
		<div className='summary-row-filter-bar'>
		</div>
	);
}
