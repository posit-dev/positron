/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./columnsPanel';

// React.
import * as React from 'react';
import { useLayoutEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { generateUuid } from 'vs/base/common/uuid';
import { usePositronDataExplorerContext } from 'vs/base/browser/ui/positronDataExplorer/positronDataExplorerContext';
import { ColumnEntry } from 'vs/base/browser/ui/positronDataExplorer/components/dataExplorerPanel/components/columnEntry';
import { FixedSizeList as List, ListChildComponentProps, ListOnItemsRenderedProps, ListOnScrollProps } from 'react-window';

/**
 * Constants.
 */
const ROW_HEIGHT = 26;

/**
 * ColumnsPanelProps interface.
 */
interface ColumnsPanelProps {
	width: number;
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
	const context = usePositronDataExplorerContext();

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
	 * Column component.
	 * @param index The index of the column entry.
	 * @param style The style (positioning) at which to render the column entry.
	 * @param isScrolling A value which indicates whether the list is scrolling.
	 * @returns The rendered column entry.
	 */
	const Column = (props: ListChildComponentProps<DummyColumnInfo>) => {
		// Get the entry being rendered.
		const column = dummyColumns[props.index];

		if (initialScrollOffset) {
			return (
				<div key={column.key} style={props.style} />
			);
		}

		// Render.
		return (
			<ColumnEntry key={column.key} dummyColumnInfo={column} style={props.style} />
		);
	};

	// Render.
	return (
		<div ref={columnsPanel} className='columns-panel'>
			<div className='columns-container'>
				<List
					className='list'
					ref={listRef}
					innerRef={innerRef}
					itemCount={dummyColumns.length}
					// Use a custom item key instead of index.
					itemKey={index => dummyColumns[index].key}
					width='100%'
					height={props.height}
					itemSize={ROW_HEIGHT}
					overscanCount={10}
					onItemsRendered={itemsRenderedHandler}
					onScroll={scrollHandler}
				>
					{Column}
				</List>
			</div>
		</div>
	);
};
