/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './PositronNotebookHeader.css';

// React.
import React from 'react';

// Other dependencies.
import { KernelStatusBadge } from './KernelStatusBadge.js';
import { IPositronNotebookInstance } from './IPositronNotebookInstance.js';

export function PositronNotebookHeader({ notebookInstance }: { notebookInstance: IPositronNotebookInstance }) {
	return <div className='positron-notebook-header'>
		<KernelStatusBadge />
	</div>;
}

