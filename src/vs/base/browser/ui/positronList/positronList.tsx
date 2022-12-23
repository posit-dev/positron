/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronList';
import * as React from 'react';
import { PropsWithChildren, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { PositronListItem } from 'vs/base/browser/ui/positronList/positronListItem';
import { PositronScrollable } from 'vs/base/browser/ui/positronList/positronScrollable';
import { PositronListItemContent } from 'vs/base/browser/ui/positronList/positronListItemContent';

/**
 * ListItem interface.
 */
export interface ListItem {
	/**
	 * Gets the ID of the list item.
	 */
	readonly id: string;

	/**
	 * Gets the height of the item.
	 */
	readonly height: number;

	/**
	 * Gets the item element.
	 */
	readonly element: JSX.Element;
}

/**
 * PositronListProps interface.
 */
export interface PositronListProps {
	height: number;
	listItems: ListItem[];
}

/**
 * PositronList component.
 * @param props A PositronListProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronList = ({ height, listItems }: PropsWithChildren<PositronListProps>) => {
	// Hooks.
	const [scrollTop, setScrollTop] = useState(0);

	// Scroll handler.
	const scrollHandler = (scrollTop: number) => {
		console.log(`scrollTop ${scrollTop}`);
		setScrollTop(scrollTop);
	};

	// TODO@softwarenerd - There is an upper limit to how tall a DIV can be.
	// Google Chrome represents laid out element positions using LayoutUnits,
	// which can represent 1/64th the space of a signed int(2^31/64 integral
	// values, or +/-16_777_216). So, there will have to be a limit to the
	// number of items we try to display.

	// Build the items to render.
	let itemsHeight = 0;
	const items: JSX.Element[] = [];
	listItems.forEach((item, index) => {
		// Add the item to the items to be rendered, if it should be visible.
		if (itemsHeight + item.height >= scrollTop && itemsHeight < scrollTop + height) {
			items.push(
				<PositronListItem top={itemsHeight} height={item.height} key={item.id}>
					<PositronListItemContent>
						{item.element}
					</PositronListItemContent>
				</PositronListItem>
			);
		}

		// Adjust items height.
		itemsHeight += item.height;
	});

	// Logging.
	console.log(`${new Date().getTime()} Rendered ${items.length} of ${listItems.length} items height ${height} total height ${itemsHeight}`);

	// Render.
	return (
		<div className='positron-list' style={{ height }}>
			<PositronScrollable onScroll={scrollHandler}>
				<div style={{ height: itemsHeight }}>
					{items}
				</div>
			</PositronScrollable>
		</div>
	);
};
