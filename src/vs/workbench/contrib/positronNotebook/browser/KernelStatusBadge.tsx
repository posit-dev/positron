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

// This component will eventually be much more complicated and used to
// control the kernel choice etc. For now, it just displays the kernel status.
export function KernelStatusBadge() {
	const notebookInstance = useNotebookInstance();
	const kernelStatus = useObservedValue(notebookInstance.kernelStatus);
	const services = usePositronReactServicesContext();

	return (
		<div
			aria-label='Notebook kernel status'
			className='positron-notebook-kernel-status-badge'
			role='button'
			tabIndex={0}
			onClick={() => services.commandService.executeCommand(SELECT_KERNEL_ID_POSITRON, { forceDropdown: true })}
		>
			Kernel
			<span className={`kernel-status ${kernelStatus}`}>{' ' + kernelStatus}</span>
		</div>
	);
}
