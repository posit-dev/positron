/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronList';
import * as React from 'react';
import { PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports
import { PositronListItem } from 'vs/base/browser/ui/positronList/positronListItem';
import { PositronScrollable } from 'vs/base/browser/ui/positronList/positronScrollable';
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
	/**
	 * TestItems component.
	 * @returns The rendered component.
	 */
	const TestItems = () => {
		const items: JSX.Element[] = [];

		for (let index = 0; index < 200; index++) {
			items.push(
				<PositronListItem top={index * 25} height={25}>
					<PositronListItemContent>
						List Item {index + 1}
					</PositronListItemContent>
				</PositronListItem>
			);
		}

		return (
			<>
				{items}
			</>
		);
	};

	// Render.
	return (
		<div className='positron-list' style={{ height: props.height }}>
			<PositronScrollable>
				<div className='list-contents' style={{ height: 5000 }}>
					<TestItems />
				</div>
			</PositronScrollable>
		</div>
	);
};
