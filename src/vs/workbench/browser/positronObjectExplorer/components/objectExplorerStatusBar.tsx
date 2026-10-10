/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './objectExplorerStatusBar.css';

// React.
import { useEffect, useReducer } from 'react';

// Other dependencies.
import { combinedDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { ObjectExplorerSearchResults, ObjectExplorerTreeInstance } from '../classes/objectExplorerTreeInstance.js';
import { ActivityStatusIndicator } from '../../positronComponents/activityStatusIndicator/activityStatusIndicator.js';
import { ObjectExplorerClientInstance } from '../../../services/languageRuntime/common/languageRuntimeObjectExplorerClient.js';

/**
 * ObjectExplorerStatusBarProps interface.
 */
interface ObjectExplorerStatusBarProps {
	readonly client: ObjectExplorerClientInstance;
	readonly treeInstance: ObjectExplorerTreeInstance;
	readonly searchResults: ObjectExplorerSearchResults | undefined;
}

/**
 * ObjectExplorerStatusBar component. Shows the client's activity and the accessor of the selected
 * node, or, while searching with nothing selected, the number of matches.
 */
export const ObjectExplorerStatusBar = ({ client, treeInstance, searchResults }: ObjectExplorerStatusBarProps) => {
	const [, rerender] = useReducer((x: number) => x + 1, 0);

	useEffect(() => {
		const disposable = combinedDisposable(treeInstance.onDidUpdate(rerender), client.onDidStatusUpdate(rerender));
		return () => disposable.dispose();
	}, [client, treeInstance]);

	const selected = treeInstance.getSelectedNode()?.data;
	const accessor = selected?.type === 'node' ? selected.node.accessor : undefined;
	const text = accessor ?? client.errorMessage ?? searchStatus(searchResults);

	return (
		<div className='object-explorer-status-bar'>
			<ActivityStatusIndicator status={client.status} onDidChangeStatus={client.onDidStatusUpdate} />
			{text !== undefined &&
				<span className='label' data-testid='object-explorer-status-label' title={text}>{text}</span>
			}
		</div>
	);
};

/**
 * Describes the results of a search.
 */
function searchStatus(searchResults: ObjectExplorerSearchResults | undefined): string | undefined {
	if (!searchResults) {
		return undefined;
	}
	const { total_matches, truncated } = searchResults.result;
	const matches = total_matches === 1 ?
		localize('positron.objectExplorer.searchStatusOne', "1 match") :
		localize('positron.objectExplorer.searchStatus', "{0} matches", total_matches);
	return truncated ?
		localize('positron.objectExplorer.searchTruncated', "{0} (search stopped early)", matches) :
		matches;
}
