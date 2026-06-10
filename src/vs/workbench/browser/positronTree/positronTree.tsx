/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronTree.css';

// React.
import { JSX, ReactNode, useEffect, useState } from 'react';

// Other dependencies.
import { PositronTreeInstance } from './classes/positronTreeInstance.js';
import { PositronDataGrid } from '../positronDataGrid/positronDataGrid.js';

interface PositronTreeProps<T> {
	id?: string;
	instance: PositronTreeInstance<T>;

	/**
	 * Optional renderer for the empty-state UI shown when the tree has no roots (after the
	 * initial load completes). Wrapped in a .positron-tree-empty container that fills the
	 * tree's bounds.
	 */
	emptyTreeRenderer?: () => ReactNode;

	/**
	 * Optional renderer for the loading-state UI shown while the initial roots fetch is in
	 * flight. After the first successful load, this is never shown again -- subsequent fetches
	 * are surfaced per-node (twisty spinner) or via the instance's onDidChangeLoading event.
	 */
	loadingRendererForInitialLoad?: () => ReactNode;
}

/**
 * PositronTree component. Thin React shell over a PositronTreeInstance. Subscribes to the
 * instance's onDidUpdate so the empty / loading / populated switch is reactive.
 */
export const PositronTree = <T,>({
	id,
	instance,
	emptyTreeRenderer,
	loadingRendererForInitialLoad,
}: PositronTreeProps<T>): JSX.Element => {
	// Re-render when the underlying projection changes so the empty / loading / populated
	// states switch correctly. PositronDataGrid subscribes to onDidUpdate for its own redraws
	// but doesn't drive this component, so we subscribe independently here.
	const [, setMarker] = useState({});
	useEffect(() => {
		const disposable = instance.onDidUpdate(() => setMarker({}));
		return () => disposable.dispose();
	}, [instance]);

	// Initial loading state -- shown only before the first successful load.
	if (loadingRendererForInitialLoad && !instance.initialLoadCompleted) {
		return (
			<div className='positron-tree-loading'>
				{loadingRendererForInitialLoad()}
			</div>
		);
	}

	// Empty state -- shown after the initial load when there are no roots.
	if (emptyTreeRenderer && instance.initialLoadCompleted && instance.rows === 0) {
		return (
			<div className='positron-tree-empty'>
				{emptyTreeRenderer()}
			</div>
		);
	}

	return <PositronDataGrid id={id} instance={instance} />;
};
