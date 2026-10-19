/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './objectExplorerColumnHeaders.css';

// React.
import { CSSProperties, useEffect, useReducer, useRef } from 'react';

// Other dependencies.
import { localize } from '../../../../nls.js';
import { ObjectExplorerColumnWidths, TWISTY_WIDTH } from '../classes/objectExplorerTreeInstance.js';
import { VerticalSplitter, VerticalSplitterResizeParams } from '../../../../base/browser/ui/positronComponents/splitters/verticalSplitter.js';

/**
 * ObjectExplorerColumnHeadersProps interface.
 */
interface ObjectExplorerColumnHeadersProps {
	readonly columnWidths: ObjectExplorerColumnWidths;
}

/**
 * ObjectExplorerColumnHeaders component. The Name, Type, and Value headers, with splitters that
 * resize the Name and Type columns.
 */
export const ObjectExplorerColumnHeaders = ({ columnWidths }: ObjectExplorerColumnHeadersProps) => {
	const ref = useRef<HTMLDivElement>(null);
	const [, rerender] = useReducer((x: number) => x + 1, 0);

	useEffect(() => {
		const disposable = columnWidths.onDidChange(rerender);
		return () => disposable.dispose();
	}, [columnWidths]);

	// Each column keeps at least the minimum width, and the Value column keeps at least that much.
	const resizeParams = (startingWidth: number, otherWidth: number): VerticalSplitterResizeParams => {
		const minimumWidth = ObjectExplorerColumnWidths.MINIMUM_WIDTH;
		const availableWidth = ref.current?.clientWidth ?? 0;
		return {
			minimumWidth,
			maximumWidth: Math.max(minimumWidth, availableWidth - otherWidth - minimumWidth),
			startingWidth
		};
	};

	// The splitters sit between the columns, so each column gives up a pixel to its splitter.
	const style: CSSProperties = {
		gridTemplateColumns: `${columnWidths.name - 1}px 1px ${columnWidths.type - 1}px 1px minmax(0, 1fr)`
	};

	return (
		<div ref={ref} className='object-explorer-column-headers' style={style}>
			<div className='object-explorer-column-header' style={{ paddingLeft: TWISTY_WIDTH }}>
				{localize('positron.objectExplorer.nameColumn', "Name")}
			</div>
			<VerticalSplitter
				onBeginResize={() => resizeParams(columnWidths.name, columnWidths.type)}
				onResize={width => columnWidths.set(width, columnWidths.type)}
			/>
			<div className='object-explorer-column-header'>
				{localize('positron.objectExplorer.typeColumn', "Type")}
			</div>
			<VerticalSplitter
				onBeginResize={() => resizeParams(columnWidths.type, columnWidths.name)}
				onResize={width => columnWidths.set(columnWidths.name, width)}
			/>
			<div className='object-explorer-column-header'>
				{localize('positron.objectExplorer.valueColumn', "Value")}
			</div>
		</div>
	);
};
