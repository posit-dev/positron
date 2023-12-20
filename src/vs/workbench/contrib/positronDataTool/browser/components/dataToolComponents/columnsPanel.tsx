/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./columnsPanel';
import * as React from 'react';
import { UIEvent, useEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { generateUuid } from 'vs/base/common/uuid';
import { usePositronDataToolContext } from 'vs/workbench/contrib/positronDataTool/browser/positronDataToolContext';

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
	// Context hooks.
	const context = usePositronDataToolContext();

	// Reference hooks.
	const columnsPanel = useRef<HTMLDivElement>(undefined!);

	const [columnsScrollPosition, setcolumnsScrollPosition] = useState<number | undefined>(undefined);

	useEffect(() => {
		setcolumnsScrollPosition(context.instance.columnsScrollPosition);
	}, []);

	useEffect(() => {
		if (columnsPanel.current && columnsScrollPosition) {
			setTimeout(() => {
				columnsPanel.current.scrollBy(0, columnsScrollPosition);
			}, 100);
		}

	}, [columnsPanel, columnsScrollPosition]);

	/**
	 * onScroll event handler.
	 * @param e A UIEvent<HTMLDivElement> that describes a user interaction with the mouse.
	 */
	const scrollHandler = (e: UIEvent<HTMLDivElement>) => {
		// Set the scroll position.
		context.instance.columnsScrollPosition = columnsPanel.current.scrollTop;
	};

	// Render.
	return (
		<div ref={columnsPanel} className='columns-panel' onScroll={scrollHandler}>
			{dummyColumns.map(column =>
				<div className='title' key={column.key}>{column.name}</div>
			)}
		</div>
	);
};
