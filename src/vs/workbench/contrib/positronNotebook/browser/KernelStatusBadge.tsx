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
import { ActionButton } from './utilityComponents/ActionButton.js';
import { useServices } from './ServicesProvider.js';
import { SELECT_KERNEL_ID_POSITRON } from './SelectPositronNotebookKernelAction.js';

// This component will eventually be much more complicated and used to
// control the kernel choice etc. For now, it just displays the kernel status.
export function KernelStatusBadge() {
	const notebookInstance = useNotebookInstance();
	const kernelStatus = useObservedValue(notebookInstance.kernelStatus);
	const services = useServices();

	return <ActionButton
		className='positron-notebook-kernel-status-badge'
		onPressed={() => services.commandService.executeCommand(SELECT_KERNEL_ID_POSITRON, { forceDropdown: true })}
	>
		<div>
			Kernel
			<span className={`kernel-status ${kernelStatus}`}>{' ' + kernelStatus}</span>
		</div>
	</ActionButton>;
}
