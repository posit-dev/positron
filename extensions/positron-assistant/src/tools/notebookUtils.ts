/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';

/**
 * Format cell status information for display in prompts
 */
export function formatCellStatus(cell: positron.notebooks.NotebookCell): string {
	const statusParts: string[] = [];

	// Selection status
	statusParts.push(`Selection: ${cell.selectionStatus}`);

	// Execution status (only for code cells)
	if (cell.executionStatus !== undefined) {
		statusParts.push(`Execution: ${cell.executionStatus}`);
		if (cell.executionOrder !== undefined) {
			statusParts.push(`Order: [${cell.executionOrder}]`);
		}
		if (cell.lastRunSuccess !== undefined) {
			statusParts.push(`Last run: ${cell.lastRunSuccess ? 'success' : 'failed'}`);
		}
		if (cell.lastExecutionDuration !== undefined) {
			const durationMs = cell.lastExecutionDuration;
			const durationStr = durationMs < 1000
				? `${durationMs}ms`
				: `${(durationMs / 1000).toFixed(2)}s`;
			statusParts.push(`Duration: ${durationStr}`);
		}
	}

	// Output status
	statusParts.push(cell.hasOutput ? 'Has output' : 'No output');

	return statusParts.join(' | ');
}

/**
 * Format a collection of cells for display in prompts
 */
export function formatCells(cells: positron.notebooks.NotebookCell[], prefix: string): string {
	if (cells.length === 0) {
		return prefix === 'Selected Cell' ? 'No cells currently selected' : '';
	}

	return cells.map((cell, idx) => {
		const statusInfo = formatCellStatus(cell);
		const cellLabel = cells.length === 1
			? prefix
			: `${prefix} ${idx + 1}`;
		return `
### ${cellLabel} - ${cell.type} [Index ${cell.index}]
Cell ID: ${cell.id}
Status: ${statusInfo}
\`\`\`
${cell.content}
\`\`\``;
	}).join('\n');
}
