/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronList';
import * as React from 'react';
import { PropsWithChildren, useRef } from 'react'; // eslint-disable-line no-duplicate-imports
import { PositronListItem } from 'vs/base/browser/ui/positronList/positronListItem';
import { PositronListItemContent } from 'vs/base/browser/ui/positronList/positronListItemContent';

/**
 * PositronListSource interface.
 */
export interface PositronListSource {
	count: number;
	getItem: (index: number) => JSX.Element;
}

/**
 * PositronListProps interface.
 */
export interface PositronListProps {
	height: number;
}

/**
 * PositronList component.
 * @param props A PositronListProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronList = (props: PropsWithChildren<PositronListProps>) => {
	// Hooks.
	const listContainerRef = useRef<HTMLDivElement>(undefined!);

	// Add event handlers.
	React.useEffect(() => {
	}, []);

	// Scroll handler.
	const scrollHandler = (e: React.UIEvent<HTMLDivElement, UIEvent>) => {
		console.log(e);
		console.log(`scrollTop: ${listContainerRef.current.scrollTop}`);
	};

	/**
	 * TestItems component.
	 * @returns The rendered component.
	 */
	const TestItems = () => {
		return (
			<>
				<PositronListItem top={0} height={25}>
					<PositronListItemContent>
						List Item 1
					</PositronListItemContent>
				</PositronListItem>
				<PositronListItem top={25} height={25}>
					<PositronListItemContent>
						List Item 2
					</PositronListItemContent>
				</PositronListItem>
				<PositronListItem top={50} height={25}>
					<PositronListItemContent>
						List Item 3
					</PositronListItemContent>
				</PositronListItem>
			</>
		);
	};

	// Render.
	return (
		<div ref={listContainerRef} className='positron-list-container' style={{ height: props.height }} onScroll={scrollHandler}>
			<div className='list-contents' style={{ height: 26000 }}>
				<TestItems />
			</div>
		</div>
	);
};
