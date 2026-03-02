/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { IMemoryUsageSnapshot } from '../../../../../platform/positronMemoryUsage/common/positronMemoryUsage.js';

/**
 * MemoryUsageBar props.
 */
interface MemoryUsageBarProps {
	snapshot: IMemoryUsageSnapshot;
	className?: string;
}

/**
 * MemoryUsageBar component.
 * Renders a segmented memory bar from a snapshot. Reusable across the toolbar
 * meter and the dropdown popup.
 */
export const MemoryUsageBar = (props: MemoryUsageBarProps) => {
	const { snapshot, className } = props;
	const { totalSystemMemory, kernelTotalBytes, positronOverheadBytes, otherProcessesBytes } = snapshot;

	// Compute segment percentages.
	const total = totalSystemMemory || 1; // avoid division by zero
	const kernelPct = (kernelTotalBytes / total) * 100;
	const positronPct = (positronOverheadBytes / total) * 100;
	const otherPct = (otherProcessesBytes / total) * 100;

	// Build segments.
	const segments: React.ReactElement[] = [];

	if (kernelPct > 0) {
		segments.push(
			<div
				key='kernel'
				className='memory-bar-segment kernel'
				style={{ flexBasis: `${kernelPct}%` }}
			/>
		);
	}

	if (positronPct > 0) {
		segments.push(
			<div
				key='positron'
				className='memory-bar-segment positron'
				style={{ flexBasis: `${positronPct}%` }}
			/>
		);
	}

	if (otherPct > 0) {
		segments.push(
			<div
				key='other'
				className='memory-bar-segment other'
				style={{ flexBasis: `${otherPct}%` }}
			/>
		);
	}

	const containerClass = className
		? `memory-bar-container ${className}`
		: 'memory-bar-container';

	return (
		<div className={containerClass}>
			{segments}
		</div>
	);
};
