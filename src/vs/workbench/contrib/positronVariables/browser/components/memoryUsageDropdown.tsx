/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './memoryUsageDropdown.css';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { ByteSize } from '../../../../../platform/files/common/files.js';
import { IMemoryUsageSnapshot } from '../../../../../platform/positronMemoryUsage/common/positronMemoryUsage.js';
import { PositronModalPopup } from '../../../../browser/positronComponents/positronModalPopup/positronModalPopup.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { MemoryUsageBar } from './memoryUsageBar.js';

// Localized strings.
const sessionsHeader = localize('positron.memoryUsage.sessions', "Sessions");
const overheadHeader = localize('positron.memoryUsage.overhead', "Overhead");
const systemHeader = localize('positron.memoryUsage.system', "System");
const positronLabel = localize('positron.memoryUsage.positron', "Positron");
const otherLabel = localize('positron.memoryUsage.other', "Other");
const freeLabel = localize('positron.memoryUsage.free', "Free");

/**
 * MemoryUsageDropdown props.
 */
interface MemoryUsageDropdownProps {
	anchorElement: HTMLElement;
	renderer: PositronModalReactRenderer;
	snapshot: IMemoryUsageSnapshot;
}

/**
 * A single row in the memory usage breakdown table.
 */
interface UsageRowEntry {
	name: string;
	bytes: number;
	barClass: string;
}

/**
 * MemoryUsageDropdown component.
 * Renders the detailed memory usage breakdown popup.
 */
export const MemoryUsageDropdown = (props: MemoryUsageDropdownProps) => {
	const { snapshot } = props;

	// Compute summary percentage and total for the header.
	const usedBytes = snapshot.totalSystemMemory - snapshot.freeSystemMemory;
	const usedPct = snapshot.totalSystemMemory > 0
		? Math.round((usedBytes / snapshot.totalSystemMemory) * 100)
		: 0;
	const totalGB = ByteSize.formatSize(snapshot.totalSystemMemory);

	// Build all rows to find the max value for scaling bars.
	const sessionRows: UsageRowEntry[] = snapshot.kernelSessions.map(s => ({
		name: s.sessionName,
		bytes: s.memoryBytes,
		barClass: 'kernel',
	}));

	const overheadRows: UsageRowEntry[] = [
		{ name: positronLabel, bytes: snapshot.positronOverheadBytes, barClass: 'positron' },
	];

	const systemRows: UsageRowEntry[] = [
		{ name: otherLabel, bytes: snapshot.otherProcessesBytes, barClass: 'other' },
		{ name: freeLabel, bytes: snapshot.freeSystemMemory, barClass: 'free' },
	];

	const allRows = [...sessionRows, ...overheadRows, ...systemRows];
	const maxBytes = Math.max(...allRows.map(r => r.bytes), 1);

	const renderRow = (row: UsageRowEntry, index: number) => {
		const barWidthPct = (row.bytes / maxBytes) * 100;
		return (
			<div key={`${row.barClass}-${index}`} className='usage-row' role='row'>
				<span className='usage-name' role='cell'>{row.name}</span>
				<span className='usage-size' role='cell'>{ByteSize.formatSize(row.bytes)}</span>
				<div className='usage-bar-container' role='cell'>
					<div
						className={`usage-bar ${row.barClass}`}
						style={{ width: `${barWidthPct}%` }}
					/>
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
					<span role='columnheader'>{overheadHeader}</span>
				</div>
				{overheadRows.map((row, i) => renderRow(row, i))}
				<div className='section-header' role='row'>
					<span role='columnheader'>{systemHeader}</span>
				</div>
				{systemRows.map((row, i) => renderRow(row, i))}
			</div>
		</PositronModalPopup>
	);
};
