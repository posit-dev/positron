/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./rowsPanel';
import * as React from 'react';
import { UIEvent, useEffect, useRef } from 'react'; // eslint-disable-line no-duplicate-imports
import { generateUuid } from 'vs/base/common/uuid';
// import { usePositronDataToolContext } from 'vs/workbench/contrib/positronDataTool/browser/positronDataToolContext';

/**
 * RowsPanelProps interface.
 */
interface RowsPanelProps {
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
export const RowsPanel = (props: RowsPanelProps) => {
	// Context hooks.
	// const context = usePositronDataToolContext();

	// Reference hooks.
	const rowsPanel = useRef<HTMLDivElement>(undefined!);

	// Main useEffect.
	useEffect(() => {
		// console.log(`rowsPanel is ${rowsPanel} and rowsScrollPosition is ${context.instance.rowsScrollOffset}`);
	}, []);

	/**
	 * onScroll event handler.
	 * @param e A UIEvent<HTMLDivElement> that describes a user interaction with the mouse.
	 */
	const scrollHandler = (e: UIEvent<HTMLDivElement>) => {
	};

	// Render.
	return (
		<div ref={rowsPanel} className='rows-panel' onScroll={scrollHandler}>
			{dummyRows.map(row =>
				<div className='title' key={row.key}>{row.name}</div>
			)}
		</div>
	);
};
