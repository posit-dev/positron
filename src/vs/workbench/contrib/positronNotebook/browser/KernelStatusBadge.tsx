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
import { SELECT_KERNEL_ID_POSITRON } from './SelectPositronNotebookKernelAction.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';

// This component displays the current kernel's language and connection status.
// It shows the language name (e.g., "Python", "R") and the current status state.
// Clicking the badge opens the kernel picker to select a different kernel.
export function KernelStatusBadge() {
	const notebookInstance = useNotebookInstance();
	const kernelStatus = useObservedValue(notebookInstance.kernelStatus);
	const runtimeInfo = useObservedValue(notebookInstance.runtimeInfo);
	const services = usePositronReactServicesContext();

	// Format tooltip with runtime details
	const tooltipContent = React.useMemo(() => {
		if (!runtimeInfo) {
			return 'No kernel connected';
		}

		// Build multi-line tooltip with key runtime information
		return [
			runtimeInfo.runtimeName,
			'',
			`State: ${runtimeInfo.state}`,
			`Session: ${runtimeInfo.sessionId.slice(0, 12)}...`,
			`Path: ${runtimeInfo.runtimePath}`,
			`Source: ${runtimeInfo.runtimeSource}`,
		].join('\n');
	}, [runtimeInfo]);

	// Display language name or fallback to "Kernel"
	const displayName = runtimeInfo?.languageName ?? 'Kernel';

	return (
		<div
			aria-label={`Notebook kernel: ${displayName} - ${kernelStatus}`}
			className='positron-notebook-kernel-status-badge'
			role='button'
			tabIndex={0}
			title={tooltipContent}
			onClick={() => services.commandService.executeCommand(SELECT_KERNEL_ID_POSITRON, { forceDropdown: true })}
		>
			{displayName}
			<span className={`kernel-status ${kernelStatus}`}>{' ' + kernelStatus}</span>
		</div>
	);
}
