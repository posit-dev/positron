/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './memoryUsageDropdown.css';

// React.
import { useEffect, useState } from 'react';

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
const platformHeader = localize('positron.memoryUsage.platform', "Platform");
const summaryHeader = localize('positron.memoryUsage.summary', "Summary");
const positronLabel = localize('positron.memoryUsage.positron', "Positron");
const electronLabel = localize('positron.memoryUsage.electron', "Electron");
const serverLabel = localize('positron.memoryUsage.server', "Server");
const extensionsLabel = localize('positron.memoryUsage.extensions', "Extensions");
const terminalsLabel = localize('positron.memoryUsage.terminals', "Terminals");
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
}

/**
 * A single row in the memory usage breakdown table.
 * When `segments` is provided, the bar is split into multiple colored segments.
 */
interface UsageRowEntry {
	name: string;
	bytes: number;
	barClass: string;
	segments?: BarSegment[];
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

	// Compute summary percentage and total for the header.
	const usedBytes = snapshot.totalSystemMemory - snapshot.freeSystemMemory;
	const usedPct = snapshot.totalSystemMemory > 0
		? Math.min(100, Math.round((usedBytes / snapshot.totalSystemMemory) * 100))
		: 0;
	const totalGB = ByteSize.formatSize(snapshot.totalSystemMemory);

	// Build session rows sorted by memory usage descending.
	// When there are more than 8 sessions, show the top 7 individually
	// and aggregate the rest into an "Others" row.
	const MAX_VISIBLE_SESSIONS = 7;
	const MAX_SESSIONS_BEFORE_COLLAPSE = 8;
	const sortedSessions = [...snapshot.kernelSessions]
		.sort((a, b) => b.memoryBytes - a.memoryBytes);

	let sessionRows: UsageRowEntry[];
	if (sortedSessions.length > MAX_SESSIONS_BEFORE_COLLAPSE) {
		const visible = sortedSessions.slice(0, MAX_VISIBLE_SESSIONS);
		const rest = sortedSessions.slice(MAX_VISIBLE_SESSIONS);
		const othersBytes = rest.reduce((sum, s) => sum + s.memoryBytes, 0);
		sessionRows = visible.map(s => ({
			name: s.sessionName,
			bytes: s.memoryBytes,
			barClass: 'kernel',
		}));
		sessionRows.push({
			name: localize(
				'positron.memoryUsage.others',
				"Others ({0})",
				rest.length
			),
			bytes: othersBytes,
			barClass: 'kernel',
		});
	} else {
		sessionRows = sortedSessions.map(s => ({
			name: s.sessionName,
			bytes: s.memoryBytes,
			barClass: 'kernel',
		}));
	}

	const platformRows: UsageRowEntry[] = [
		{
			name: snapshot.isRemote ? serverLabel : electronLabel,
			bytes: snapshot.electronOrServerBytes,
			barClass: 'positron',
		},
		{ name: extensionsLabel, bytes: snapshot.extensionsBytes, barClass: 'positron' },
		{ name: terminalsLabel, bytes: snapshot.terminalsBytes, barClass: 'positron' },
	];

	// Positron total = kernels + editor overhead (same value as the action bar meter).
	const positronTotalBytes = snapshot.kernelTotalBytes + snapshot.positronOverheadBytes;
	const summaryRows: UsageRowEntry[] = [
		{
			name: positronLabel,
			bytes: positronTotalBytes,
			barClass: 'positron-total',
			segments: [
				{ bytes: snapshot.kernelTotalBytes, barClass: 'kernel' },
				{ bytes: snapshot.positronOverheadBytes, barClass: 'positron' },
			],
		},
	];

	const systemRows: UsageRowEntry[] = [
		{ name: otherLabel, bytes: snapshot.otherProcessesBytes, barClass: 'other' },
		{ name: freeLabel, bytes: snapshot.freeSystemMemory, barClass: 'free' },
	];

	const allRows = [...sessionRows, ...platformRows, ...summaryRows, ...systemRows];
	const maxBytes = Math.max(...allRows.map(r => r.bytes), 1);

	const renderRow = (row: UsageRowEntry, index: number) => {
		const barWidthPct = maxBytes > 0 ? ((row.bytes || 0) / maxBytes) * 100 : 0;
		return (
			<div key={`${row.barClass}-${index}`} className='usage-row' role='row'>
				<span className='usage-name' role='cell'>{row.name}</span>
				<span className='usage-size' role='cell'>{ByteSize.formatSize(row.bytes)}</span>
				<div className='usage-bar-container' role='cell'>
					{row.segments ? (
						<div
							className='usage-bar segmented'
							style={{ width: `${barWidthPct}%` }}
						>
							{row.segments.map((seg, j) => {
								const segPct = row.bytes > 0
									? (seg.bytes / row.bytes) * 100
									: 0;
								return segPct > 0 ? (
									<div
										key={j}
										className={`usage-bar-segment ${seg.barClass}`}
										style={{ flexBasis: `${segPct}%` }}
									/>
								) : null;
							})}
						</div>
					) : (
						<div
							className={`usage-bar ${row.barClass}`}
							style={{ width: `${barWidthPct}%` }}
						/>
					)}
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
			width={320}
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
				<MemoryUsageBar className='summary-bar' snapshot={snapshot} />
			</div>
			<div aria-label={localize('positron.memoryUsage.breakdown', "Memory usage breakdown")} className='memory-usage-dropdown' role='table'>
				{sessionRows.length > 0 && (
					<>
						<div className='section-header' role='row'>
							<span role='columnheader'>{sessionsHeader}</span>
						</div>
						{sessionRows.map((row, i) => renderRow(row, i))}
					</>
				)}
				<div className='section-header' role='row'>
					<span role='columnheader'>{platformHeader}</span>
				</div>
				{platformRows.map((row, i) => renderRow(row, i))}
				<div className='section-header' role='row'>
					<span role='columnheader'>{summaryHeader}</span>
				</div>
				{summaryRows.map((row, i) => renderRow(row, i))}
				{systemRows.map((row, i) => renderRow(row, i))}
			</div>
		</PositronModalPopup>
	);
};
