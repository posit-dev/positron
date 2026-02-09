/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useEffect, useRef } from 'react';

// Other dependencies.
import { ActionRunner } from '../../../../../base/common/actions.js';
import { MenuId } from '../../../../../platform/actions/common/actions.js';
import { useNotebookInstance } from '../NotebookInstanceProvider.js';
import { useCellScopedContextKeyService } from './CellContextKeyServiceProvider.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { CellSelectionType } from '../selectionMachine.js';
import { PositronNotebookCodeCell } from '../PositronNotebookCells/PositronNotebookCodeCell.js';
import { IAnchor } from '../../../../../base/browser/ui/contextview/contextview.js';

/**
 * A hook that provides the cell output context menu.
 *
 * This hook extracts the common context menu logic so it can be used by the
 * CellOutputLeftActionMenu (ellipses button to the left of code cell outputs)
 * and the context menu shown when right-clicking on a code cell output container.
 *
 * @param cell The code cell whose outputs the menu will operate on
 * @returns The showCellOutputContextMenu function that can be called with
 *          either an HTMLElement (for buttons) or coordinates (for right-clicks)
 */
export function useCellOutputContextMenu(cell: PositronNotebookCodeCell) {
	const instance = useNotebookInstance();
	const contextKeyService = useCellScopedContextKeyService();
	const { contextMenuService } = usePositronReactServicesContext();
	const actionRunnerRef = useRef<ActionRunner>();

	/**
	 * Create and setup the action runner which allows us to run code
	 * before/after an action executes. We need to make the provided cell
	 * the selected cell before any action run. This is necessary because
	 * the cell actions use the notebook selection state to determine which
	 * cell to operate on.
	 *
	 * If we didn't do this, then certain actions (e.g. "Collapse Outputs") would operate
	 * on the selected cell instead of the one that the user clicked on.
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
	 * Shows the context menu for cell output actions.
	 *
	 * @param anchor Either an HTMLElement (for button-triggered menus) or
	 *               an IAnchor with x/y coordinates (for right-click menus)
	 * @param onHide Optional callback to run when the menu is hidden
	 */
	const showCellOutputContextMenu = (anchor: HTMLElement | IAnchor, onHide?: () => void) => {
		if (!actionRunnerRef.current) {
			return;
		}

		contextMenuService.showContextMenu({
			menuId: MenuId.PositronNotebookCellOutputActionLeft,
			contextKeyService,
			getAnchor: () => anchor,
			actionRunner: actionRunnerRef.current,
			onHide,
		});
	};

	return { showCellOutputContextMenu };
}
