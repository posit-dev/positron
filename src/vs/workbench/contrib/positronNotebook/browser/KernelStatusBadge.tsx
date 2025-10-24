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
import { MenuId, MenuItemAction, SubmenuItemAction } from '../../../../platform/actions/common/actions.js';
import { ActionBarMenuButton } from '../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { useMenu } from './useMenu.js';
import { IPositronNotebookActionBarContext } from '../../runtimeNotebookKernel/browser/runtimeNotebookKernelActions.js';

const kernelStatusToRuntimeStatus = {
	[KernelStatus.Uninitialized]: RuntimeStatus.Disconnected,
	[KernelStatus.Disconnected]: RuntimeStatus.Disconnected,
	[KernelStatus.Connected]: RuntimeStatus.Idle,
	[KernelStatus.Connecting]: RuntimeStatus.Active,
	[KernelStatus.Errored]: RuntimeStatus.Disconnected,
};

const tooltip = localize('positronNotebook.kernelStatusBadge.tooltip', 'Kernel Actions');
const noRuntimeLabel = localize('positronNotebook.kernelStatusBadge.noRuntimeLabel', 'No Kernel Selected');

export function KernelStatusBadge() {
	// Context
	const notebookInstance = useNotebookInstance();

	// State
	const runtimeStatus = useObservedValue(
		notebookInstance.kernelStatus.map((kernelStatus) => kernelStatusToRuntimeStatus[kernelStatus])
	);
	const runtimeName = useObservedValue(
		notebookInstance.runtimeSession.map((runtimeSession) =>
			runtimeSession ? runtimeSession.runtimeMetadata.runtimeName : noRuntimeLabel)
	);
	const menu = useMenu(MenuId.PositronNotebookKernelSubmenu, notebookInstance.scopedContextKeyService);

	// Callback to load actions from the menu
	const getActions = React.useCallback(() => {
		if (!menu.current) {
			return [];
		}
		const actions: (MenuItemAction | SubmenuItemAction)[] = [];
		for (const [_group, groupActions] of menu.current.getActions({
			arg: {
				uri: notebookInstance.uri,
				ui: true,
			} satisfies IPositronNotebookActionBarContext,
			shouldForwardArgs: true,
		})) {
			actions.push(...groupActions);
		}
		return actions;
	}, [menu, notebookInstance.uri]);

	return (
		<ActionBarMenuButton
			actions={getActions}
			align='left'
			ariaLabel={tooltip}
			tooltip={tooltip}
		>
			<div className='positron-notebook-kernel-status-badge' data-testid='notebook-kernel-status'>
				<RuntimeStatusIcon status={runtimeStatus} />
				<p className='runtime-name'>{runtimeName}</p>
			</div>
		</ActionBarMenuButton>
	);
}
