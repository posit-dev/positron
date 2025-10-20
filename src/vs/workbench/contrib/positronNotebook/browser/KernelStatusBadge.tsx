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
	const notebookInstance = useNotebookInstance();
	const runtimeStatus = useObservedValue(
		notebookInstance.kernelStatus.map((kernelStatus) => kernelStatusToRuntimeStatus[kernelStatus])
	);
	const runtimeName = useObservedValue(
		notebookInstance.runtimeSession.map((runtimeSession) =>
			runtimeSession ? runtimeSession.runtimeMetadata.runtimeName : noRuntimeLabel)
	);

	const menuService = usePositronReactServicesContext().get(IMenuService);

	const [menu, setMenu] = React.useState<IMenu | undefined>();

	React.useEffect(() => {
		if (!notebookInstance.scopedContextKeyService) {
			return;
		}
		const disposables = new DisposableStore();
		// TODO: When to dispose? Should this menu live on the notebook instance instead?...
		setMenu(disposables.add(menuService.createMenu(MenuId.PositronNotebookKernelSubmenu, notebookInstance.scopedContextKeyService)));
		return () => {
			disposables.dispose();
			setMenu(undefined);
		};
	}, [menuService, notebookInstance.scopedContextKeyService]);

	const actions = React.useCallback(() => {
		if (!menu) {
			return [];
		}
		// Populate actions from menu
		const allActions: IAction[] = [];
		for (const [_group, actions] of menu.getActions({
			// TODO: We could pass the notebookinstance if we impl inotebookeditor...
			arg: notebookInstance.uri,
			shouldForwardArgs: true,
		})) {
			allActions.push(...actions);
		}
		return allActions;
	}, [menu, notebookInstance.uri]);

	return (
		<ActionBarMenuButton
			actions={actions}
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
