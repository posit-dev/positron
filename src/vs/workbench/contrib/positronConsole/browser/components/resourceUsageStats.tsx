/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { ByteSize } from '../../../../../platform/files/common/files.js';

/**
 * ResourceUsageStatsProps interface.
 */
interface ResourceUsageStatsProps {
	/** The CPU usage percentage */
	cpuPercent: number;
	/** The memory usage in bytes */
	memoryBytes: number;
}

/**
 * ResourceUsageStats component.
 * Displays CPU and memory usage in a compact format.
 */
export const ResourceUsageStats = ({ cpuPercent, memoryBytes }: ResourceUsageStatsProps) => {
	// Format CPU as integer percentage
	const cpuDisplay = `CPU ${Math.round(cpuPercent)}%`;

	// Format memory using ByteSize helper
	const memoryDisplay = `MEM ${ByteSize.formatSize(memoryBytes)}`;

	return (
		<div className="resource-usage-stats">
			<span className="resource-usage-cpu">{cpuDisplay}</span>
			<span className="resource-usage-memory">{memoryDisplay}</span>
		</div>
	);
};
