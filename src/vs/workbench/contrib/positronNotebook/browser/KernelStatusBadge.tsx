/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './KernelStatusBadge.css';

// React.
import React from 'react';

// Other dependencies.
import { useNotebookInstance } from './NotebookInstanceProvider.js';
import { useObservedValue } from './useObservedValue.js';
import { NotebookKernelStatus } from './IPositronNotebookInstance.js';
import { useSessionRuntimeState } from '../../positronConsole/browser/components/useSessionRuntimeState.js';
import { RuntimeStatusIcon } from '../../positronConsole/browser/components/runtimeStatus.js';
import { runtimeStateToRuntimeStatus, RuntimeStatus } from '../../positronConsole/common/sessionDisplayUtils.js';
import { localize } from '../../../../nls.js';
import { MenuId, MenuItemAction, SubmenuItemAction } from '../../../../platform/actions/common/actions.js';
import { ActionBarMenuButton } from '../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { useMenu } from './useMenu.js';
import { IPositronNotebookActionBarContext } from '../../runtimeNotebookKernel/browser/runtimeNotebookKernelActions.js';
import { observableFromEvent } from '../../../../base/common/observable.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';
import { ILanguageRuntimeService, RuntimeStartupPhase } from '../../../services/languageRuntime/common/languageRuntimeService.js';

const kernelStatusToLabel: Partial<Record<NotebookKernelStatus, string>> = {
	[NotebookKernelStatus.Discovering]: localize('positronNotebook.kernelStatusBadge.discovering', 'Discovering Interpreters...'),
	[NotebookKernelStatus.Unselected]: localize('positronNotebook.kernelStatusBadge.unselected', 'No Kernel Selected'),
	[NotebookKernelStatus.Switching]: localize('positronNotebook.kernelStatusBadge.switching', 'Switching Kernels...'),
	[NotebookKernelStatus.Exited]: localize('positronNotebook.kernelStatusBadge.exited', 'Kernel Exited'),
};

const runtimeStartupPhaseToLabel: Partial<Record<RuntimeStartupPhase, string>> = {
	[RuntimeStartupPhase.AwaitingTrust]: localize('positronNotebook.kernelStatusBadge.awaitingTrust', 'Awaiting Trust...'),
};

const tooltip = localize('positronNotebook.kernelStatusBadge.tooltip', 'Kernel Actions');

export function KernelStatusBadge() {
	const notebookInstance = useNotebookInstance();
	const services = usePositronReactServicesContext();
	const languageRuntimeService = services.get(ILanguageRuntimeService);

	const session = useObservedValue(notebookInstance.runtimeSession);
	const runtimeState = useSessionRuntimeState(session);
	const kernelStatus = useObservedValue(notebookInstance.kernelStatus);
	const kernel = useObservedValue(notebookInstance.kernel);
	const startupPhase = useObservedValue(observableFromEvent(
		languageRuntimeService.onDidChangeRuntimeStartupPhase,
		() => languageRuntimeService.startupPhase,
	));

	// The icon reflects session connection state: a live session drives it
	// via runtimeState, and no session means Disconnected. The two overrides
	// (Switching, Discovering) intentionally show Active to communicate a
	// transition the user kicked off or the app is working through, even
	// though no session is attached during those windows.
	let runtimeStatus: RuntimeStatus;
	if (kernelStatus === NotebookKernelStatus.Switching) {
		runtimeStatus = RuntimeStatus.Active;
	} else if (runtimeState !== undefined) {
		runtimeStatus = runtimeStateToRuntimeStatus[runtimeState];
	} else if (kernelStatus === NotebookKernelStatus.Discovering) {
		runtimeStatus = RuntimeStatus.Active;
	} else {
		runtimeStatus = RuntimeStatus.Disconnected;
	}

	let label: string;
	if (kernel) {
		label = kernel.runtime.runtimeName;
	} else if (session) {
		label = session.runtimeMetadata.runtimeName;
	} else if (startupPhase && runtimeStartupPhaseToLabel[startupPhase]) {
		label = runtimeStartupPhaseToLabel[startupPhase]!;
	} else {
		label = kernelStatusToLabel[kernelStatus] ?? '';
	}

	const menu = useMenu(
		MenuId.PositronNotebookKernelSubmenu,
		notebookInstance.scopedContextKeyService
	);

	// Callback to load actions from the menu
	const getActions = React.useCallback(() => {
		if (!menu.current) {
			return [];
		}
		const actions: (MenuItemAction | SubmenuItemAction)[] = [];
		for (const [_group, groupActions] of menu.current.getActions({
			arg: {
				instance: notebookInstance,
			} satisfies IPositronNotebookActionBarContext,
			shouldForwardArgs: true,
		})) {
			actions.push(...groupActions);
		}
		return actions;
	}, [menu, notebookInstance]);

	return (
		<ActionBarMenuButton
			actions={getActions}
			align='left'
			ariaLabel={tooltip}
			tooltip={tooltip}
		>
			<div className='positron-notebook-kernel-status-badge' data-testid='notebook-kernel-status'>
				<RuntimeStatusIcon status={runtimeStatus} />
				<p className='kernel-label'>{label}</p>
			</div>
		</ActionBarMenuButton>
	);
}
