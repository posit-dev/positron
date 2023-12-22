/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./columnsPanel';
import * as React from 'react';
import { useLayoutEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { generateUuid } from 'vs/base/common/uuid';
import { usePositronDataToolContext } from 'vs/workbench/contrib/positronDataTool/browser/positronDataToolContext';
import { FixedSizeList as List, ListChildComponentProps, ListOnItemsRenderedProps, ListOnScrollProps } from 'react-window';
import { ColumnController } from 'vs/workbench/contrib/positronDataTool/browser/components/dataToolComponents/columnController';

/**
 * Constants.
 */
const ROW_HEIGHT = 26;

/**
 * ColumnsPanelProps interface.
 */
interface ColumnsPanelProps {
	height: number;
}

/**
 * DummyColumnInfo interface.
 */
export interface DummyColumnInfo {
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
for (let i = 0; i < 64; i++) {
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
	const listRef = useRef<List>(undefined!);
	const innerRef = useRef<HTMLElement>(undefined!);

	// State hooks.
	const [initialScrollOffset, setInitialScrollOffset] = useState(
		context.instance.columnsScrollOffset
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
			context.instance.columnsScrollOffset = scrollOffset;
		} else {
			console.log(`Ignoring scrollHandler during first render for scrollOffset ${scrollOffset}`);
		}
	};

	/**
	 * ColumnEntry component.
	 * @param index The index of the column entry.
	 * @param style The style (positioning) at which to render the column entry.
	 * @param isScrolling A value which indicates whether the list is scrolling.
	 * @returns The rendered column entry.
	 */
	const ColumnEntry = (props: ListChildComponentProps<DummyColumnInfo>) => {
		// Get the entry being rendered.
		const column = dummyColumns[props.index];

		// console.log(`Render ColumnEntry ${props.index} firstRender ${firstRender}`);

		if (initialScrollOffset) {
			return (
				<div key={column.key} style={props.style}></div>
			);
		}

		// Render.
		return (
			<ColumnController
				key={column.key}
				dummyColumnInfo={column}
				style={props.style}
			/>
		);
	};

	// Render.
	return (
		<div ref={columnsPanel} className='columns-panel'>
			<List
				className='list'
				ref={listRef}
				innerRef={innerRef}
				itemCount={dummyColumns.length}
				// Use a custom item key instead of index.
				itemKey={index => dummyColumns[index].key}
				width='100%'
				height={props.height - 2}
				itemSize={ROW_HEIGHT}
				overscanCount={10}
				onItemsRendered={itemsRenderedHandler}
				onScroll={scrollHandler}
			>
				{ColumnEntry}
			</List>
		</div>
	);
};
