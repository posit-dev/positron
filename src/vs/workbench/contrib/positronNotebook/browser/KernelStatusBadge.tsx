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
import { derived, observableFromEvent } from '../../../../base/common/observable.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';
import { ILanguageRuntimeService, RuntimeStartupPhase } from '../../../services/languageRuntime/common/languageRuntimeService.js';

const kernelStatusToRuntimeStatus: Record<KernelStatus, RuntimeStatus> = {
	// Disconnected
	[KernelStatus.Unselected]: RuntimeStatus.Disconnected,
	[KernelStatus.Exited]: RuntimeStatus.Disconnected,
	// Idle
	[KernelStatus.Idle]: RuntimeStatus.Idle,
	// Active
	[KernelStatus.Discovering]: RuntimeStatus.Active,
	[KernelStatus.Starting]: RuntimeStatus.Active,
	[KernelStatus.Restarting]: RuntimeStatus.Active,
	[KernelStatus.Switching]: RuntimeStatus.Active,
	[KernelStatus.Exiting]: RuntimeStatus.Active,
	[KernelStatus.Busy]: RuntimeStatus.Active,
};

const kernelStatusToLabel: Partial<Record<KernelStatus, string>> = {
	[KernelStatus.Discovering]: localize('positronNotebook.kernelStatusBadge.discovering', 'Discovering Interpreters...'),
	[KernelStatus.Unselected]: localize('positronNotebook.kernelStatusBadge.unselected', 'No Kernel Selected'),
};

const runtimeStartupPhaseToLabel: Partial<Record<RuntimeStartupPhase, string>> = {
	[RuntimeStartupPhase.AwaitingTrust]: localize('positronNotebook.kernelStatusBadge.awaitingTrust', 'Awaiting Trust...'),
};

const tooltip = localize('positronNotebook.kernelStatusBadge.tooltip', 'Kernel Actions');

export function KernelStatusBadge() {
	// Context
	const notebookInstance = useNotebookInstance();
	const services = usePositronReactServicesContext();
	const languageRuntimeService = services.get(ILanguageRuntimeService);

	// State
	const runtimeStatus = useObservedValue(notebookInstance.kernelStatus.map((kernelStatus) =>
		kernelStatusToRuntimeStatus[kernelStatus]));
	const startupPhaseObs = observableFromEvent(
		languageRuntimeService.onDidChangeRuntimeStartupPhase,
		() => languageRuntimeService.startupPhase,
	);
	const label = useObservedValue(derived(reader => {
		const kernel = notebookInstance.kernel.read(reader);
		const kernelStatus = notebookInstance.kernelStatus.read(reader);
		const startupPhase = startupPhaseObs.read(reader);
		// Prefer the kernel's runtime name, if available
		if (kernel) {
			return kernel.runtime.runtimeName;
		}
		// Display known runtime startup phases
		if (runtimeStartupPhaseToLabel[startupPhase]) {
			return runtimeStartupPhaseToLabel[startupPhase];
		}
		// Display known kernel statuses
		if (kernelStatusToLabel[kernelStatus]) {
			return kernelStatusToLabel[kernelStatus];
		}
		// This shouldn't happen...
		return '';
	}));
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

	// Add ref to log button geometry when menu opens
	const buttonDebugRef = React.useRef<HTMLDivElement>(null);

	// Debug: Log button position when component renders
	React.useEffect(() => {
		if (buttonDebugRef.current) {
			const rect = buttonDebugRef.current.getBoundingClientRect();
			console.log('KERNEL STATUS BADGE: Button geometry:', {
				x: rect.x,
				y: rect.y,
				width: rect.width,
				height: rect.height,
				visible: rect.width > 0 && rect.height > 0
			});
		}
	});

	return (
		<ActionBarMenuButton
			actions={getActions}
			align='left'
			ariaLabel={tooltip}
			tooltip={tooltip}
		>
			<div
				ref={buttonDebugRef}
				className='positron-notebook-kernel-status-badge'
				data-testid='notebook-kernel-status'
			>
				<RuntimeStatusIcon status={runtimeStatus} />
				<p className='kernel-label'>{label}</p>
			</div>
		</ActionBarMenuButton>
	);
}
