/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronList.css';

// React.
import { JSX, ReactNode, useEffect, useState } from 'react';

// Other dependencies.
import { PositronListInstance } from './classes/positronListInstance.js';
import { PositronDataGrid } from '../positronDataGrid/positronDataGrid.js';

/**
 * PositronListProps interface.
 */
interface PositronListProps<TItem, TSection> {
	id?: string;
	instance: PositronListInstance<TItem, TSection>;

	/**
	 * Optional renderer for the empty-state UI shown when the list has no entries. The result
	 * is wrapped in a .positron-list-empty container that fills the list's bounds and centers
	 * its content; the renderer just returns the message (or whatever) to display. If omitted,
	 * an empty list renders as the data grid with no rows.
	 */
	emptyListRenderer?: () => ReactNode;
}

/**
 * PositronList component.
 */
export const PositronList = <TItem, TSection = never>({ id, instance, emptyListRenderer }: PositronListProps<TItem, TSection>): JSX.Element => {
	// Re-render when the underlying entries change so the empty-state / list switch is reactive.
	// PositronDataGrid subscribes to onDidUpdate for its own redraws, but it doesn't drive this
	// component, so we subscribe independently here.
	const [, setMarker] = useState({});
	useEffect(() => {
		const disposable = instance.onDidUpdate(() => setMarker({}));
		return () => disposable.dispose();
	}, [instance]);

	// Show the empty-state UI when there are no entries and the caller supplied a renderer.
	if (emptyListRenderer && instance.rows === 0) {
		return (
			<div className='positron-list-empty'>
				{emptyListRenderer()}
			</div>
		);
	}

	return <PositronDataGrid id={id} instance={instance} />;
};
