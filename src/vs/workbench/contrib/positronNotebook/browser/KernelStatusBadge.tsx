/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './KernelStatusBadge.css';

// React.
import React from 'react';

// Other dependencies.
import { useNotebookInstance } from './NotebookInstanceProvider.js';
import { useObservedValue } from './useObservedValue.js';
import { KernelStatus } from './IPositronNotebookInstance.js';
import { RuntimeStatus, RuntimeStatusIcon } from '../../positronConsole/browser/components/runtimeStatus.js';
import { localize } from '../../../../nls.js';
import { ActionBarMenuButton } from '../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { IAction } from '../../../../base/common/actions.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';
import { IMenu, IMenuService, MenuId } from '../../../../platform/actions/common/actions.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';

const kernelStatusToRuntimeStatus = {
	[KernelStatus.Uninitialized]: RuntimeStatus.Disconnected,
	[KernelStatus.Disconnected]: RuntimeStatus.Disconnected,
	[KernelStatus.Connected]: RuntimeStatus.Idle,
	[KernelStatus.Connecting]: RuntimeStatus.Active,
	[KernelStatus.Errored]: RuntimeStatus.Disconnected,
};

const noRuntimeLabel = localize('positronNotebook.kernelStatusBadge.noRuntimeLabel', 'No Kernel Selected');

/**
 * KernelStatusBadge - An interactive component that displays the current kernel status
 * and provides a menu for kernel-related actions.
 *
 * This is a self-contained widget that manages its own interactions.
 * It uses ActionBarMenuButton to display a menu when clicked.
 */
export function KernelStatusBadge() {
	// Context
	const notebookInstance = useNotebookInstance();
	const menuService = usePositronReactServicesContext().get(IMenuService);

	// State
	const runtimeStatus = useObservedValue(
		notebookInstance.kernelStatus.map((kernelStatus) => kernelStatusToRuntimeStatus[kernelStatus])
	);
	const runtimeName = useObservedValue(
		notebookInstance.runtimeSession.map((runtimeSession) =>
			runtimeSession ? runtimeSession.runtimeMetadata.runtimeName : noRuntimeLabel)
	);
	const [menu, setMenu] = React.useState<IMenu | undefined>();
	const [menuVersion, incrementMenuVersion] = React.useReducer(x => x + 1, 0);
	// const [actions, setActions] = React.useState<IAction[]>([]);

	// TODO: Extract useMenuActions?
	// React.useEffect(() => {
	// 	if (!notebookInstance.scopedContextKeyService) {
	// 		// Can't create a menu without the context key service
	// 		return;
	// 	}

	// 	// Create the menu
	// 	const disposables = new DisposableStore();
	// 	const menu = disposables.add(menuService.createMenu(
	// 		MenuId.PositronNotebookKernelSubmenu, notebookInstance.scopedContextKeyService,
	// 	));

	// 	/** Helper to set the actions state from the menu */
	// 	const refreshActions = () => {
	// 		const actions: IAction[] = [];
	// 		for (const [_group, actions] of menu.getActions({
	// 			// TODO: Could/should we match the upstream arg type for compatibility?
	// 			arg: notebookInstance.uri,
	// 			shouldForwardArgs: true,
	// 		})) {
	// 			actions.push(...actions);
	// 		}
	// 		setActions(actions);
	// 	};

	// 	// Refresh actions when the menu changes
	// 	disposables.add(menu.onDidChange(() => {
	// 		refreshActions();
	// 	}));

	// 	// Load current actions
	// 	refreshActions();

	// 	return () => {
	// 		// Clear actions
	// 		disposables.dispose();
	// 		setActions([]);
	// 	};
	// }, [menuService, notebookInstance.scopedContextKeyService, notebookInstance.uri]);

	React.useEffect(() => {
		if (!notebookInstance.scopedContextKeyService) {
			// Can't create a menu without the context key service
			return;
		}

		// Create the menu
		const disposables = new DisposableStore();
		const menu = disposables.add(menuService.createMenu(
			MenuId.PositronNotebookKernelSubmenu, notebookInstance.scopedContextKeyService,
		));
		setMenu(menu);

		// Refresh actions when the menu changes
		disposables.add(menu.onDidChange(() => {
			incrementMenuVersion();
		}));

		return () => {
			// Clear the menu
			disposables.dispose();
			setMenu(undefined);
		};
	}, [menuService, notebookInstance.scopedContextKeyService, notebookInstance.uri]);

	/** Load the actions from the menu. */
	const getActions = React.useCallback(() => {
		void menuVersion;  // reference menuVersion for eslint
		if (!menu) {
			return [];
		}
		const actions: IAction[] = [];
		for (const [_group, groupActions] of menu.getActions({
			// TODO: Could/should we match the upstream arg type for compatibility?
			arg: notebookInstance.uri,
			shouldForwardArgs: true,
		})) {
			actions.push(...groupActions);
		}
		return actions;
	}, [menu, notebookInstance.uri, menuVersion]);

	return (
		<ActionBarMenuButton
			actions={getActions}
			align='left'
			ariaLabel={localize('kernelActions', 'Kernel actions')}
			tooltip={localize('kernelActionsTooltip', 'Click to see kernel actions')}
		>
			<div className='positron-notebook-kernel-status-badge' data-testid='notebook-kernel-status'>
				<RuntimeStatusIcon status={runtimeStatus} />
				{/* TODO: Runtime name or session name? */}
				<p className='session-name'>{runtimeName}</p>
			</div>
		</ActionBarMenuButton>
	);
}
