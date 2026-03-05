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
	highlightedIds?: ReadonlySet<string> | null;
	onSegmentHover?: (id: string | null) => void;
}

/**
 * MemoryUsageBar component.
 * Renders a segmented memory bar from a snapshot. Reusable across the toolbar
 * meter and the dropdown popup.
 *
 * When used in the dropdown with hover linking, each kernel session and each
 * overhead item is rendered as its own sub-segment so that hovering a single
 * table row highlights exactly one sub-segment in this bar, and vice versa.
 */
export const MemoryUsageBar = (props: MemoryUsageBarProps) => {
	const { snapshot, className, highlightedIds, onSegmentHover } = props;
	const total = snapshot.totalSystemMemory || 1; // avoid division by zero

	// Build sub-segments: one per session, one per overhead item, one for other.
	interface SubSegment { id: string; bytes: number; colorClass: string }
	const subs: SubSegment[] = [];

	snapshot.kernelSessions.forEach((s, i) => {
		if (s.memoryBytes > 0) {
			subs.push({ id: `session:${i}`, bytes: s.memoryBytes, colorClass: 'kernel' });
		}
	});
	if (snapshot.positronOverheadBytes > 0) {
		subs.push({ id: 'overhead:platform', bytes: snapshot.positronOverheadBytes, colorClass: 'positron' });
	}
	if (snapshot.extensionHostOverheadBytes > 0) {
		subs.push({ id: 'overhead:extensions', bytes: snapshot.extensionHostOverheadBytes, colorClass: 'positron' });
	}
	if (snapshot.otherProcessesBytes > 0) {
		subs.push({ id: 'other', bytes: snapshot.otherProcessesBytes, colorClass: 'other' });
	}
	if (snapshot.freeSystemMemory > 0) {
		subs.push({ id: 'free', bytes: snapshot.freeSystemMemory, colorClass: 'free' });
	}

	// Compute percentages, clamping to 100% total so that
	// double-counted memory does not cause visual overflow.
	const rawPcts = subs.map(s => (s.bytes / total) * 100);
	const sumPct = rawPcts.reduce((a, b) => a + b, 0);
	const scale = sumPct > 100 ? 100 / sumPct : 1;
	const pcts = rawPcts.map(p => p * scale);

	const isHighlighting = highlightedIds !== undefined && highlightedIds !== null && highlightedIds.size > 0;

	// Build segment elements.
	const elements: React.ReactElement[] = [];
	for (let i = 0; i < subs.length; i++) {
		const sub = subs[i];
		const pct = pcts[i];
		if (pct <= 0) {
			continue;
		}
		const classes = ['memory-bar-segment', sub.colorClass];
		if (isHighlighting) {
			classes.push(highlightedIds.has(sub.id) ? 'highlighted' : 'dimmed');
		}
		elements.push(
			<div
				key={sub.id}
				className={classes.join(' ')}
				style={{ flexBasis: `${pct}%` }}
				onMouseEnter={onSegmentHover ? () => onSegmentHover(sub.id) : undefined}
				onMouseLeave={onSegmentHover ? () => onSegmentHover(null) : undefined}
			/>
		);
	}

	const containerClass = className
		? `memory-bar-container ${className}`
		: 'memory-bar-container';

	return (
		<div className={containerClass}>
			{elements}
		</div>
	);
};
