/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronList';
import * as React from 'react';
import { PropsWithChildren, useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IListItemsProvider } from 'vs/base/common/positronStuff';
import { PositronListItem } from 'vs/base/browser/ui/positronList/positronListItem';
import { PositronScrollable } from 'vs/base/browser/ui/positronList/positronScrollable';
import { PositronListItemContent } from 'vs/base/browser/ui/positronList/positronListItemContent';

/**
 * IPositronListProps interface.
 */
export interface PositronListProps {
	height: number;
	listItemsProvider: IListItemsProvider;
}

/**
 * PositronList component.
 * @param props A PositronListProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronList = ({ height, listItemsProvider }: PropsWithChildren<PositronListProps>) => {
	// Hooks.
	const [scrollTop, setScrollTop] = useState(0);
	const [, setFoo] = useState(0);

	useEffect(() => {
		// Create a disposable store for the event handlers we'll add.
		const disposableStore = new DisposableStore();

		// Add the did start runtime event handler for the language runtime service.
		disposableStore.add(listItemsProvider.onDidChangeListItems(() => {
			console.log('---------------***** we should re-render');
			setFoo(foo => foo + 1);
		}));

		// Return the clean up for our event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Scroll handler.
	const scrollHandler = (scrollTop: number) => {
		// console.log(`scrollTop ${scrollTop}`);
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
	listItemsProvider.listItems.forEach((item, index) => {
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
	// console.log(`${new Date().getTime()} Rendered ${items.length} of ${listItems.length} items height ${height} total height ${itemsHeight}`);

	// Render.
	return (
		<div className='positron-list' style={{ height }}>
			<PositronScrollable onScroll={scrollHandler}>
				<div style={{ height: itemsHeight, transform: 'translate3d(0px, 0px, 0px)', contain: 'strict' }}>
					{items}
				</div>
			</PositronScrollable>
		</div>
	);
};
