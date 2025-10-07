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

/**
 * KernelStatusBadge - A presentational component that displays the current kernel status.
 *
 * The widget simply displays the kernel status using the notebook instance from context.
 * All interaction logic is handled by the action bar widget system.
 */
export function KernelStatusBadge() {
	const notebookInstance = useNotebookInstance();
	const kernelStatus = useObservedValue(notebookInstance.kernelStatus);

	return (
		<div className='positron-notebook-kernel-status-badge' data-testid='notebook-kernel-status'>
			Kernel
			<span className={`kernel-status ${kernelStatus}`}>{' ' + kernelStatus}</span>
		</div>
	);
}
