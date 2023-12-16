/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./rowsPanel';
import * as React from 'react';
import { generateUuid } from 'vs/base/common/uuid';

/**
 * RowsPanelProps interface.
 */
interface ColumnsPanelProps {
}

/**
 * DummyRowInfo interface.
 */
interface DummyRowInfo {
	key: string;
	name: string;
}

/**
 * Dummy rows.
 */
const dummyRows: DummyRowInfo[] = [];

/**
 * Fill the dummy rows.
 */
for (let i = 0; i < 100; i++) {
	dummyRows.push({
		key: generateUuid(),
		name: `This is row ${i + 1}`
	});
}

/**
 * RowsPanel component.
 * @param props A RowsPanelProps that contains the component properties.
 * @returns The rendered component.
 */
export const RowsPanel = (props: ColumnsPanelProps) => {
	return (
		<div className='rows-panel'>
			{dummyRows.map(row =>
				<div className='title' key={row.key}>{row.name}</div>
			)}
		</div>
	);
};
