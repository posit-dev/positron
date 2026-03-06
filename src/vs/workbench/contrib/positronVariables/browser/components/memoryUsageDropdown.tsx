/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './memoryUsageDropdown.css';

// React.
import { useCallback, useEffect, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { Event } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ByteSize } from '../../../../../platform/files/common/files.js';
import { IMemoryUsageSnapshot } from '../../../../../platform/positronMemoryUsage/common/positronMemoryUsage.js';
import { PositronModalPopup } from '../../../../browser/positronComponents/positronModalPopup/positronModalPopup.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { MemoryUsageBar } from './memoryUsageBar.js';

// Localized strings.
const sessionsHeader = localize('positron.memoryUsage.sessions', "Sessions");
const overheadHeader = localize('positron.memoryUsage.overhead', "Overhead");
const summaryHeader = localize('positron.memoryUsage.summary', "Summary");
const positronLabel = localize('positron.memoryUsage.positron', "Positron");
const platformLabel = localize('positron.memoryUsage.platform', "Platform");
const extensionsLabel = localize('positron.memoryUsage.extensions', "Extensions");
const otherLabel = localize('positron.memoryUsage.other', "Other");
const freeLabel = localize('positron.memoryUsage.free', "Free");

/**
 * MemoryUsageDropdown props.
 */
interface MemoryUsageDropdownProps {
	anchorElement: HTMLElement;
	renderer: PositronModalReactRenderer;
	snapshot: IMemoryUsageSnapshot;
	onDidUpdateMemoryUsage: Event<IMemoryUsageSnapshot>;
}

/**
 * A segment within a multi-segment usage bar.
 */
interface BarSegment {
	bytes: number;
	barClass: string;
	highlightId?: string;
}

/**
 * A single row in the memory usage breakdown table.
 * When `segments` is provided, the bar is split into multiple colored segments.
 * The `highlightIds` array links the row to one or more sub-segments in the
 * summary bar for two-way hover highlighting.
 */
interface UsageRowEntry {
	name: string;
	bytes: number;
	barClass: string;
	segments?: BarSegment[];
	highlightIds?: string[];
}

/**
 * MemoryUsageDropdown component.
 * Renders the detailed memory usage breakdown popup.
 */
export const MemoryUsageDropdown = (props: MemoryUsageDropdownProps) => {
	// Subscribe to live updates so the popup stays in sync with the action bar.
	const [snapshot, setSnapshot] = useState(props.snapshot);
	useEffect(() => {
		const disposables = new DisposableStore();
		disposables.add(props.onDidUpdateMemoryUsage(s => setSnapshot(s)));
		return () => disposables.dispose();
	}, [props.onDidUpdateMemoryUsage]);

	// Track which items are highlighted for two-way hover linking.
	// A set is used so that composite rows (e.g. Positron total) can
	// highlight multiple sub-segments in the summary bar at once.
	const [highlightedIds, setHighlightedIds] = useState<ReadonlySet<string> | null>(null);
	const onHover = useCallback((id: string | null) => {
		setHighlightedIds(id ? new Set([id]) : null);
	}, []);
	const onHoverMultiple = useCallback((ids: string[]) => {
		setHighlightedIds(ids.length > 0 ? new Set(ids) : null);
	}, []);

	// Compute summary percentage and total for the header.
	const usedBytes = snapshot.totalSystemMemory - snapshot.freeSystemMemory;
	const usedPct = snapshot.totalSystemMemory > 0
		? Math.min(100, Math.round((usedBytes / snapshot.totalSystemMemory) * 100))
		: 0;
	const totalGB = ByteSize.formatSize(snapshot.totalSystemMemory);

	// Build all rows to find the max value for scaling bars.
	// IDs must match those used by MemoryUsageBar: session:{index},
	// overhead:platform, overhead:extensions, other.
	const sessionRows: UsageRowEntry[] = snapshot.kernelSessions.map((s, i) => ({
		name: s.sessionName,
		bytes: s.memoryBytes,
		barClass: 'kernel',
		highlightIds: [`session:${i}`],
	}));

	const overheadRows: UsageRowEntry[] = [
		{ name: platformLabel, bytes: snapshot.positronOverheadBytes, barClass: 'positron', highlightIds: ['overhead:platform'] },
		{ name: extensionsLabel, bytes: snapshot.extensionHostOverheadBytes, barClass: 'positron', highlightIds: ['overhead:extensions'] },
	];

	// Positron total = kernels + platform overhead + extension host overhead.
	// The segmented bar inside this row has per-item sub-segments so hover
	// linking works at the individual row level.
	const positronTotalBytes = snapshot.kernelTotalBytes + snapshot.positronOverheadBytes + snapshot.extensionHostOverheadBytes;
	const summarySegments: BarSegment[] = [
		...snapshot.kernelSessions.map((s, i) => ({
			bytes: s.memoryBytes,
			barClass: 'kernel',
			highlightId: `session:${i}`,
		})),
		{ bytes: snapshot.positronOverheadBytes, barClass: 'positron', highlightId: 'overhead:platform' },
		{ bytes: snapshot.extensionHostOverheadBytes, barClass: 'positron', highlightId: 'overhead:extensions' },
	];
	// The Positron row highlights ALL its sub-segments when hovered as a whole.
	const positronHighlightIds = summarySegments.map(s => s.highlightId).filter((id): id is string => !!id);
	const summaryRows: UsageRowEntry[] = [
		{
			name: positronLabel,
			bytes: positronTotalBytes,
			barClass: 'positron-total',
			segments: summarySegments,
			highlightIds: positronHighlightIds,
		},
	];

	const systemRows: UsageRowEntry[] = [
		{ name: otherLabel, bytes: snapshot.otherProcessesBytes, barClass: 'other', highlightIds: ['other'] },
		{ name: freeLabel, bytes: snapshot.freeSystemMemory, barClass: 'free', highlightIds: ['free'] },
	];

	const allRows = [...sessionRows, ...overheadRows, ...summaryRows, ...systemRows];
	const maxBytes = Math.max(...allRows.map(r => r.bytes), 1);

	// Total bytes for Sessions and Overhead groups.
	const sessionsTotalBytes = sessionRows.reduce((sum, r) => sum + r.bytes, 0);
	const overheadTotalBytes = overheadRows.reduce((sum, r) => sum + r.bytes, 0);

	const isHighlighting = highlightedIds !== null && highlightedIds.size > 0;

	const renderRow = (row: UsageRowEntry, index: number) => {
		// Scale bars so the longest one uses 85% of the container width,
		// reserving the remaining space for the percentage label.
		const barWidthPct = (row.bytes / maxBytes) * 85;
		const pctOfTotal = snapshot.totalSystemMemory > 0
			? (row.bytes / snapshot.totalSystemMemory) * 100
			: 0;
		const pctLabel = pctOfTotal < 1 && pctOfTotal > 0
			? '<1%'
			: `${Math.round(pctOfTotal)}%`;

		// Determine highlight state for this row's bar.
		const rowIds = row.highlightIds;
		const isRowHighlighted = isHighlighting && rowIds !== undefined &&
			rowIds.some(id => highlightedIds.has(id));
		const isRowDimmed = isHighlighting && !isRowHighlighted;

		// The hover target spans the size label, bar, and percentage columns.
		const hoverHandlers = rowIds ? {
			onMouseEnter: () => onHoverMultiple(rowIds),
			onMouseLeave: () => onHoverMultiple([]),
		} : {};

		// Highlight/dim class applied to the bar element only.
		const barHighlightClass = isRowHighlighted ? ' highlighted' : isRowDimmed ? ' dimmed' : '';

		return (
			<div key={`${row.barClass}-${index}`} className='usage-row' role='row'>
				<span className='usage-name' role='cell'>{row.name}</span>
				<div
					className='usage-row-hover-target'
					{...hoverHandlers}
				>
					<span className='usage-size' role='cell'>{ByteSize.formatSize(row.bytes)}</span>
					<div className='usage-bar-container' role='cell'>
						{row.segments ? (
							<div
								className={`usage-bar segmented${barHighlightClass}`}
								style={{ flexBasis: `${barWidthPct}%` }}
							>
								{row.segments.map((seg, j) => {
									const segPct = row.bytes > 0
										? (seg.bytes / row.bytes) * 100
										: 0;
									const segId = seg.highlightId;
									const segHighlight = isHighlighting && segId
										? (highlightedIds.has(segId) ? ' highlighted' : ' dimmed')
										: '';
									return segPct > 0 ? (
										<div
											key={j}
											className={`usage-bar-segment ${seg.barClass}${segHighlight}`}
											style={{ flexBasis: `${segPct}%` }}
											onMouseEnter={segId ? () => onHover(segId) : undefined}
											onMouseLeave={segId ? () => onHover(null) : undefined}
										/>
									) : null;
								})}
							</div>
						) : (
							<div
								className={`usage-bar ${row.barClass}${barHighlightClass}`}
								style={{ flexBasis: `${barWidthPct}%` }}
							/>
						)}
						<span className='usage-pct-label'>{pctLabel}</span>
					</div>
				</div>
			</div>
		);
	};

	return (
		<PositronModalPopup
			anchorElement={props.anchorElement}
			fixedHeight={true}
			height='auto'
			keyboardNavigationStyle='dialog'
			popupAlignment='right'
			popupPosition='bottom'
			renderer={props.renderer}
			width={400}
		>
			<div className='memory-usage-dropdown-summary'>
				<div className='summary-text'>
					{localize(
						'positron.memoryUsage.summaryPct',
						"{0}% of {1}",
						usedPct,
						totalGB
					)}
				</div>
				<MemoryUsageBar
					className='summary-bar'
					snapshot={snapshot}
					highlightedIds={highlightedIds}
					onSegmentHover={onHover}
				/>
			</div>
			<div aria-label={localize('positron.memoryUsage.breakdown', "Memory usage breakdown")} className='memory-usage-dropdown' role='table'>
				{sessionRows.length > 0 && (
					<>
						<div className='section-header' role='row'>
							<span role='columnheader'>
								{sessionsHeader}
								<span className='section-header-total'>
									{' ('}{ByteSize.formatSize(sessionsTotalBytes)}{')'}
								</span>
							</span>
						</div>
						{sessionRows.map((row, i) => renderRow(row, i))}
					</>
				)}
				<div className='section-header' role='row'>
					<span role='columnheader'>
						{overheadHeader}
						<span className='section-header-total'>
							{' ('}{ByteSize.formatSize(overheadTotalBytes)}{')'}
						</span>
					</span>
				</div>
				{overheadRows.map((row, i) => renderRow(row, i))}
				<div className='section-header' role='row'>
					<span role='columnheader'>{summaryHeader}</span>
				</div>
				{summaryRows.map((row, i) => renderRow(row, i))}
				{systemRows.map((row, i) => renderRow(row, i))}
			</div>
		</PositronModalPopup>
	);
};
