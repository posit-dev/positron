/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import 'vs/css!./KernelStatusBadge';

import * as React from 'react';
import { useNotebookInstance } from 'vs/workbench/contrib/positronNotebook/browser/NotebookInstanceProvider';
import { useObservedValue } from './useObservedValue';

// This component will eventually be much more complicated and used to
// control the kernel choice etc. For now, it just displays the kernel status.
export function KernelStatusBadge() {
	const notebookInstance = useNotebookInstance();
	const kernelStatus = useObservedValue(notebookInstance.kernelStatus);

	return <div className='positron-notebook-kernel-status-badge'>
		Kernel
		<span className={`kernel-status ${kernelStatus}`}>{' ' + kernelStatus}</span>
	</div>;
}
