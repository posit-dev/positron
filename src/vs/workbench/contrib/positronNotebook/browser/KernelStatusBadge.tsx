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
import { KernelStatus } from './IPositronNotebookInstance.js';
import { useNotebookRuntimeSession } from './useNotebookRuntimeSession.js';
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

const kernelStatusToLabel: Record<KernelStatus, string> = {
	[KernelStatus.Discovering]: localize('positronNotebook.kernelStatusBadge.discovering', 'Discovering Interpreters...'),
	[KernelStatus.Unselected]: localize('positronNotebook.kernelStatusBadge.unselected', 'No Kernel Selected'),
	[KernelStatus.Switching]: localize('positronNotebook.kernelStatusBadge.switching', 'Switching Kernels...'),
	[KernelStatus.Exited]: localize('positronNotebook.kernelStatusBadge.exited', 'Kernel Exited'),
};

const runtimeStartupPhaseToLabel: Partial<Record<RuntimeStartupPhase, string>> = {
	[RuntimeStartupPhase.AwaitingTrust]: localize('positronNotebook.kernelStatusBadge.awaitingTrust', 'Awaiting Trust...'),
};

const tooltip = localize('positronNotebook.kernelStatusBadge.tooltip', 'Kernel Actions');

export function KernelStatusBadge() {
	const notebookInstance = useNotebookInstance();
	const services = usePositronReactServicesContext();
	const languageRuntimeService = services.get(ILanguageRuntimeService);

	const session = useNotebookRuntimeSession(notebookInstance.uri);
	const runtimeState = useSessionRuntimeState(session);
	const kernelStatus = useObservedValue(notebookInstance.kernelStatus);
	const kernel = useObservedValue(notebookInstance.kernel);
	const startupPhase = useObservedValue(observableFromEvent(
		languageRuntimeService.onDidChangeRuntimeStartupPhase,
		() => languageRuntimeService.startupPhase,
	));

	// Display status: prefer the runtime session's state. When no session is
	// attached, derive from pre-session kernelStatus, then fall back to
	// "Active" if a kernel was picked and we're waiting for its session.
	let runtimeStatus: RuntimeStatus;
	if (runtimeState !== undefined) {
		runtimeStatus = runtimeStateToRuntimeStatus[runtimeState];
	} else if (kernelStatus === KernelStatus.Unselected || kernelStatus === KernelStatus.Exited) {
		runtimeStatus = RuntimeStatus.Disconnected;
	} else if (kernelStatus === KernelStatus.Discovering || kernelStatus === KernelStatus.Switching) {
		runtimeStatus = RuntimeStatus.Active;
	} else {
		runtimeStatus = kernel ? RuntimeStatus.Active : RuntimeStatus.Disconnected;
	}

	let label: string;
	if (kernel) {
		label = kernel.runtime.runtimeName;
	} else if (session) {
		label = session.runtimeMetadata.runtimeName;
	} else if (startupPhase && runtimeStartupPhaseToLabel[startupPhase]) {
		label = runtimeStartupPhaseToLabel[startupPhase]!;
	} else if (kernelStatus !== undefined) {
		label = kernelStatusToLabel[kernelStatus];
	} else {
		label = '';
	}

	// scopedContextKeyService is only available after attachView() is called.
	// When a notebook replaces a preview tab, the widget may render before
	// attachView() completes. Use container (set last in attachView) as the
	// readiness signal.
	const container = useObservedValue(notebookInstance.container);
	const menu = useMenu(
		MenuId.PositronNotebookKernelSubmenu,
		container ? notebookInstance.scopedContextKeyService : undefined
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
