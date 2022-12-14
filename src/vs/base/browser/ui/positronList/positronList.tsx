/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronList';
import * as React from 'react';
import { PropsWithChildren, useRef } from 'react'; // eslint-disable-line no-duplicate-imports
import { ListItem } from 'vs/base/browser/ui/positronList/components/listItem';
import { FooBar } from 'vs/base/browser/ui/positronList/components/fooBar';

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

	const yoodle = () => {
		return (
			<>
				<ListItem top={0} height={25}>
					<FooBar>
						List Item 1
					</FooBar>
				</ListItem>
				<ListItem top={25} height={25}>
					<FooBar>
						List Item 2
					</FooBar>
				</ListItem>
				<ListItem top={50} height={25}>
					<FooBar>
						List Item 3
					</FooBar>
				</ListItem>
			</>
		);
	};

	// Render.
	return (
		<div ref={listContainerRef} className='positron-list-container' style={{ height: props.height }} onScroll={scrollHandler}>
			<div className='list-contents' style={{ height: 26000 }}>
				{yoodle()}
			</div>
		</div>
	);
};
