/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React from 'react';

interface ExecutionStatusBadgeProps {
	cellSelected: boolean;
	isHovered: boolean;
	executionOrder?: number;
	showPending: boolean;
}

/**
 * Component that displays execution order badges like [1], [2], or [-] for pending cells.
 * Used when the cell is not selected/hovered and showing static execution status.
 */
export function ExecutionStatusBadge({ cellSelected, isHovered, executionOrder, showPending }: ExecutionStatusBadgeProps) {

	if (cellSelected || isHovered) {
		// We show action buttons in this case
		return null;
	}

	if (showPending) {
		return <span className='execution-order-badge'>-</span>;
	}

	if (executionOrder !== undefined) {
		return (
			<div className='execution-order-badge-container'>
				<span className='execution-order-badge-bracket'>[</span>
				<span className='execution-order-badge'> {String(executionOrder)} </span>
				<span className='execution-order-badge-bracket'>]</span>
			</div>
		);
	}

	return null;
}
