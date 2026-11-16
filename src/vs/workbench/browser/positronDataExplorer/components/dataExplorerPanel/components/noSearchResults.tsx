/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './noSearchResults.css';

// React.
import { useEffect, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../../nls.js';
import { DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { Button } from '../../../../../../base/browser/ui/positronComponents/button/button.js';
import { usePositronDataExplorerContext } from '../../../positronDataExplorerContext.js';
import { getGlobalSearchTerm, splitRowFilters } from '../../../../../services/positronDataExplorer/common/dataExplorerSearch.js';

/**
 * NoSearchResults component. Covers the data grid when the search matches no rows.
 * @returns The rendered component, or nothing when there are matching rows or no search.
 */
export const NoSearchResults = () => {
	// Context hooks.
	const context = usePositronDataExplorerContext();
	const clientInstance = context.instance.dataExplorerClientInstance;

	// State hooks.
	const [backendState, setBackendState] = useState(() => clientInstance.cachedBackendState);

	// Main useEffect.
	useEffect(() => {
		const disposableStore = new DisposableStore();
		disposableStore.add(clientInstance.onDidUpdateBackendState(state => setBackendState(state)));
		return () => disposableStore.dispose();
	}, [clientInstance]);

	const { globalSearch } = splitRowFilters(backendState?.row_filters ?? []);
	const term = getGlobalSearchTerm(globalSearch);
	if (!backendState || term === '' || globalSearch?.is_valid === false || backendState.table_shape.num_rows > 0) {
		return null;
	}

	// The Python backend sends an unset optional field as null rather than leaving it out.
	const rowsScanned = backendState.global_search_rows_scanned;
	const limited = typeof rowsScanned === 'number';
	const gridInstance = context.instance.tableDataDataGridInstance;

	// Render.
	return (
		<div className='no-search-results'>
			<div className='message'>
				{limited ?
					localize('positron.dataExplorer.noSearchResults.limited', "No rows match '{0}' in the first {1} rows", term, rowsScanned.toLocaleString()) :
					localize('positron.dataExplorer.noSearchResults', "No rows match '{0}'", term)}
			</div>
			<div className='buttons'>
				{limited &&
					<Button
						className='no-search-results-button'
						onPressed={() => gridInstance.setSearchTerm(term, 0)}
					>
						{localize('positron.dataExplorer.noSearchResults.searchAll', "Search All")}
					</Button>
				}
				<Button
					className='no-search-results-button'
					onPressed={() => gridInstance.setSearchTerm('')}
				>
					{localize('positron.dataExplorer.noSearchResults.clearSearch', "Clear Search")}
				</Button>
			</div>
		</div>
	);
};
