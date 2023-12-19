/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./columnsPanel';
import * as React from 'react';
import { generateUuid } from 'vs/base/common/uuid';

/**
 * ColumnsPanelProps interface.
 */
interface ColumnsPanelProps {
}

/**
 * DummyColumnInfo interface.
 */
interface DummyColumnInfo {
	key: string;
	name: string;
}

/**
 * Dummy columns.
 */
const dummyColumns: DummyColumnInfo[] = [];

/**
 * Fill the dummy columns.
 */
for (let i = 0; i < 100; i++) {
	dummyColumns.push({
		key: generateUuid(),
		name: `This is column ${i + 1}`
	});
}

/**
 * ColumnsPanel component.
 * @param props A ColumnsPanelProps that contains the component properties.
 * @returns The rendered component.
 */
export const ColumnsPanel = (props: ColumnsPanelProps) => {
	return (
		<div className='columns-panel'>
			{dummyColumns.map(column =>
				<div className='title' key={column.key}>{column.name}</div>
			)}
		</div>
	);
};
