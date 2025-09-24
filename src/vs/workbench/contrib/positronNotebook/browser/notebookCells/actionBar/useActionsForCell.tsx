/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React from 'react';
import { useObservedValue } from '../../useObservedValue.js';
import { CellActionPosition, INotebookCellActionBarItem, NotebookCellActionBarRegistry } from './actionBarRegistry.js';
import { useCellScopedContextKeyService } from '../CellContextKeyServiceProvider.js';
import { POSITRON_NOTEBOOK_CELL_CONTEXT_KEYS } from '../../../../../services/positronNotebook/browser/ContextKeysManager.js';

// Create a set of all the context key names
const notebookCellContextKeysSet = new Set(Object.values(POSITRON_NOTEBOOK_CELL_CONTEXT_KEYS).map(key => key.key));

/**
 * Hook to get the all appropriate actions for a cell.
 * @param cell The cell to get the actions for.
 * @returns A record of the actions for each position.
 */
export function useActionsForCell(): Record<CellActionPosition, INotebookCellActionBarItem[]> {
	const registry = NotebookCellActionBarRegistry.getInstance();
	const contextKeyService = useCellScopedContextKeyService();

	// Trigger re-render when notebook-relevant context changes
	const [, setContextVersion] = React.useState(0);
	React.useEffect(() => {
		if (!contextKeyService) {
			return;
		}

		/**
		 * Filter context change events to only trigger re-renders when
		 * notebook-relevant keys change. This _may_ be a bit rerender happy but
		 * debouncing while accumulating events is a lot of complexity so we'll
		 * leave it until it's a problem.
		 */
		const disposable = contextKeyService.onDidChangeContext((event) => {
			// Only trigger re-render if any notebook-relevant key changed
			if (event.affectsSome(notebookCellContextKeysSet)) {
				setContextVersion(v => v + 1);
			}
		});
		return () => {
			disposable.dispose();
		};
	}, [contextKeyService]);

	const forCellFilter = (action: INotebookCellActionBarItem): boolean => {
		// If no when-clause, it's always eligible
		if (!action.when) {
			return true;
		}
		// If we don't yet have a context service (e.g., before mount), treat as not matching
		return contextKeyService ? contextKeyService.contextMatchesRules(action.when) : false;
	};

	const allLeftActions = useObservedValue(registry.leftActions) ?? [];
	const leftActions = allLeftActions.filter(forCellFilter);
	const allMainActions = useObservedValue(registry.mainActions) ?? [];
	const mainActions = allMainActions.filter(forCellFilter);
	const allMainRightActions = useObservedValue(registry.mainRightActions) ?? [];
	const mainRightActions = allMainRightActions.filter(forCellFilter);
	const allMenuActions = useObservedValue(registry.menuActions) ?? [];
	const menuActions = allMenuActions.filter(forCellFilter);
	return {
		left: leftActions,
		main: mainActions,
		mainRight: mainRightActions,
		menu: menuActions
	};
}
