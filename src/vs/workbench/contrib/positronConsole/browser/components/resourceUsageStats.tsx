/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { ByteSize } from '../../../../../platform/files/common/files.js';
import { localize } from '../../../../../nls.js';

/**
 * ResourceUsageStatsProps interface.
 */
interface ResourceUsageStatsProps {
	/** The CPU usage percentage */
	cpuPercent: number;
	/** The memory usage in bytes */
	memoryBytes: number;
}

const cpuLabel = localize('positronConsole.resourceUsageStats.cpuLabel', 'CPU');
const memoryLabel = localize('positronConsole.resourceUsageStats.memoryLabel', 'MEM');

/**
 * ResourceUsageStats component.
 * Displays CPU and memory usage in a compact format.
 */
export const ResourceUsageStats = ({ cpuPercent, memoryBytes }: ResourceUsageStatsProps) => {
	// Format CPU as integer percentage
	const cpuValue = `${Math.round(cpuPercent)}%`;

	// Format memory using ByteSize helper
	const memoryValue = ByteSize.formatSize(memoryBytes);

	return (
		<dl className="resource-usage-stats" aria-live="polite" aria-atomic="true">
			<div className="resource-usage-cpu">
				<dt className="resource-usage-label">{cpuLabel}</dt>
				<dd className="resource-usage-value">{cpuValue}</dd>
			</div>
			<div className="resource-usage-memory">
				<dt className="resource-usage-label">{memoryLabel}</dt>
				<dd className="resource-usage-value">{memoryValue}</dd>
			</div>
		</dl>
	);
};
