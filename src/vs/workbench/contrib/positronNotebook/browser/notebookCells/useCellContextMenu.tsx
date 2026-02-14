/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useEffect, useRef } from 'react';

// Other dependencies.
import { ActionRunner, IAction } from '../../../../../base/common/actions.js';
import { MenuId } from '../../../../../platform/actions/common/actions.js';
import { useNotebookInstance } from '../NotebookInstanceProvider.js';
import { useCellScopedContextKeyService } from './CellContextKeyServiceProvider.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { CellSelectionType } from '../selectionMachine.js';
import { IPositronNotebookCell } from '../PositronNotebookCells/IPositronNotebookCell.js';
import { IAnchor } from '../../../../../base/browser/ui/contextview/contextview.js';


export interface UseCellContextMenuOptions {
	/** The notebook cell the menu will operate on */
	cell: IPositronNotebookCell;
	/** The menu ID to show */
	menuId: MenuId;
}

/**
 * A generic hook that will show a context menu anywhere on a cell.
 *
 * This hook handles the common context menu logic including:
 * - Setting up an ActionRunner that selects the cell before any action runs
 * - Showing the context menu with the appropriate menu ID
 * - Optionally prepending additional actions to the menu
 *
 * @param cell The notebook cell that the context menu actions will operate on
 * @param menuId The ID of the context menu to show
 * @returns The showContextMenu function that can be called with
 *          either an HTMLElement (for buttons) or coordinates (for right-clicks)
 */
export function useCellContextMenu({ cell, menuId }: UseCellContextMenuOptions) {
	const instance = useNotebookInstance();
	const contextKeyService = useCellScopedContextKeyService();
	const { contextMenuService } = usePositronReactServicesContext();
	const actionRunnerRef = useRef<ActionRunner | undefined>(undefined);

	/**
	 * Create and setup the action runner which allows us to run code
	 * before/after an action executes. We need to make the provided cell
	 * the selected cell before any action run. This is necessary because
	 * the cell actions use the notebook selection state to determine which
	 * cell to operate on.
	 *
	 * If we didn't do this, then certain actions would operate on the
	 * selected cell instead of the one that the user clicked on.
	 */
	useEffect(() => {
		const actionRunner = new ActionRunner();

		// Select the cell before any action runs to ensure notebook selection is in sync
		const onWillRunDisposable = actionRunner.onWillRun(() => {
			instance.selectionStateMachine.selectCell(cell, CellSelectionType.Normal);
		});

		actionRunnerRef.current = actionRunner;

		return () => {
			onWillRunDisposable.dispose();
			actionRunner.dispose();
		};
	}, [cell, instance]);

	/**
	 * Shows the context menu.
	 *
	 * @param anchor Either an HTMLElement (for button-triggered menus) or
	 *               an IAnchor with x/y coordinates (for right-click menus)
	 * @param getActions Optional getter for extra actions that will be prepended to the menu.
	 *                   Called at the time the menu is shown, allowing callers to capture
	 *                   context-specific state (like text selection) at the right moment.
	 * @param onHide Optional callback to run when the menu is hidden
	 */
	const showContextMenu = (anchor: HTMLElement | IAnchor, getActions?: () => IAction[], onHide?: () => void) => {
		if (!actionRunnerRef.current) {
			return;
		}

		contextMenuService.showContextMenu({
			menuId,
			contextKeyService,
			getAnchor: () => anchor,
			actionRunner: actionRunnerRef.current,
			getActions,
			onHide,
		});
	};

	return { showContextMenu };
}
