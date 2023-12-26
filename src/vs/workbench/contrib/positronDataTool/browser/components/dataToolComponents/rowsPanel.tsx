/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./rowsPanel';
import * as React from 'react';
import { useLayoutEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { generateUuid } from 'vs/base/common/uuid';
import { usePositronDataToolContext } from 'vs/workbench/contrib/positronDataTool/browser/positronDataToolContext';
import { FixedSizeList as List, ListChildComponentProps, ListOnItemsRenderedProps, ListOnScrollProps } from 'react-window';
import { ColumnHeaders } from 'vs/workbench/contrib/positronDataTool/browser/components/dataToolComponents/columnHeaders';

/**
 * Constants.
 */
const ROW_HEIGHT = 26;

/**
 * RowsPanelProps interface.
 */
interface RowsPanelProps {
	height: number;
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
	const context = usePositronDataToolContext();

	// Reference hooks.
	const rowsPanel = useRef<HTMLDivElement>(undefined!);
	const listRef = useRef<List>(undefined!);
	const innerRef = useRef<HTMLElement>(undefined!);

	// State hooks.
	const [initialScrollOffset, setInitialScrollOffset] = useState(
		context.instance.rowsScrollOffset
	);

	// Initial scroll position layout effect.
	useLayoutEffect(() => {
		if (initialScrollOffset) {
			listRef.current.scrollTo(initialScrollOffset);
			setInitialScrollOffset(0);
		}
	}, [initialScrollOffset]);

	const itemsRenderedHandler = ({ visibleStartIndex, visibleStopIndex }: ListOnItemsRenderedProps) => {
		console.log(`-----------------> LIST height ${props.height} itemsRenderedHandler: visibleStartIndex ${visibleStartIndex} visibleStopIndex ${visibleStopIndex}`);
	};

	const scrollHandler = ({ scrollDirection, scrollOffset }: ListOnScrollProps) => {
		if (!initialScrollOffset) {
			context.instance.rowsScrollOffset = scrollOffset;
		} else {
			console.log(`Ignoring scrollHandler during first render for scrollOffset ${scrollOffset}`);
		}
	};

	/**
	 * RowEntry component.
	 * @param index The index of the column entry.
	 * @param style The style (positioning) at which to render the column entry.
	 * @param isScrolling A value which indicates whether the list is scrolling.
	 * @returns The rendered column entry.
	 */
	const RowEntry = (props: ListChildComponentProps<DummyRowInfo>) => {
		// Get the entry being rendered.
		const row = dummyRows[props.index];

		// console.log(`Render ColumnEntry ${props.index} firstRender ${firstRender}`);

		// Render.
		return (
			<div className='title' key={row.key} style={props.style}>{row.name}</div>
		);
	};

	// Render.
	return (
		<div ref={rowsPanel} className='rows-panel'>
			<ColumnHeaders />
			<List
				className='list'
				ref={listRef}
				innerRef={innerRef}
				itemCount={dummyRows.length}
				// Use a custom item key instead of index.
				itemKey={index => dummyRows[index].key}
				width='100%'
				height={props.height - 22 - 2}
				itemSize={ROW_HEIGHT}
				overscanCount={10}
				onItemsRendered={itemsRenderedHandler}
				onScroll={scrollHandler}
			>
				{RowEntry}
			</List>
		</div>
	);
};
