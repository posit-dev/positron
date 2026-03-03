/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './memoryUsageMeter.css';

// React.
import { useRef } from 'react';

// Other dependencies.
import * as DOM from '../../../../../base/browser/dom.js';
import { localize } from '../../../../../nls.js';
import { ByteSize } from '../../../../../platform/files/common/files.js';
import { IMemoryUsageSnapshot } from '../../../../../platform/positronMemoryUsage/common/positronMemoryUsage.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { MemoryUsageDropdown } from './memoryUsageDropdown.js';
import { MemoryUsageBar } from './memoryUsageBar.js';

/**
 * The fixed-width portion of the full meter (bar + arrow + gaps + padding),
 * excluding the dynamic size label text.
 *
 * bar(100) + gap(6) + gap(6) + arrow(14) + padding(4+4) = 134
 */
export const MEMORY_METER_FIXED_WIDTH = 134;

/**
 * The fixed-width portion of the compact meter (arrow + gap + padding only,
 * no bar), excluding the dynamic size label text.
 *
 * gap(6) + arrow(14) + padding(4+4) = 28
 */
export const MEMORY_METER_COMPACT_FIXED_WIDTH = 28;

/**
 * MemoryUsageMeterProps interface.
 */
interface MemoryUsageMeterProps {
	snapshot: IMemoryUsageSnapshot;
	compact?: boolean;
}

/**
 * MemoryUsageMeter component.
 * Renders a segmented memory bar in the Variables pane action bar.
 * Layout and overflow are handled by the parent PositronDynamicActionBar.
 */
export const MemoryUsageMeter = ({ snapshot, compact }: MemoryUsageMeterProps) => {
	// Services.
	const services = usePositronReactServicesContext();

	// Ref for the meter element (used for popup anchoring).
	const meterRef = useRef<HTMLDivElement>(undefined!);

	const { totalSystemMemory, kernelTotalBytes, positronOverheadBytes, extensionHostOverheadBytes } = snapshot;

	// Positron's total footprint for the label.
	const positronTotalBytes = kernelTotalBytes + positronOverheadBytes + extensionHostOverheadBytes;
	const sizeLabel = ByteSize.formatSize(positronTotalBytes);

	// Tooltip text.
	const tooltipText = localize(
		'positron.memoryUsage.tooltip',
		"Kernels: {0} | Positron: {1} | Other: {2} | Free: {3}",
		ByteSize.formatSize(kernelTotalBytes),
		ByteSize.formatSize(positronOverheadBytes + extensionHostOverheadBytes),
		ByteSize.formatSize(snapshot.otherProcessesBytes),
		ByteSize.formatSize(snapshot.freeSystemMemory)
	);

	// Accessibility label.
	const ariaLabel = localize(
		'positron.memoryUsage.ariaLabel',
		"Memory usage: {0} used by Positron and kernels out of {1} total",
		sizeLabel,
		ByteSize.formatSize(totalSystemMemory)
	);

	// Click handler to open the dropdown.
	const handleClick = () => {
		if (!meterRef.current) {
			return;
		}

		const renderer = new PositronModalReactRenderer({
			container: services.workbenchLayoutService.getContainer(DOM.getWindow(meterRef.current)),
			parent: meterRef.current,
		});

		renderer.render(
			<MemoryUsageDropdown
				anchorElement={meterRef.current}
				renderer={renderer}
				snapshot={snapshot}
				onDidUpdateMemoryUsage={services.positronMemoryUsageService.onDidUpdateMemoryUsage}
			/>
		);
	};

	return (
		<div
			ref={meterRef}
			aria-label={ariaLabel}
			aria-valuemax={totalSystemMemory}
			aria-valuemin={0}
			aria-valuenow={positronTotalBytes}
			className='memory-usage-meter'
			role='meter'
			title={tooltipText}
			onClick={handleClick}
		>
			{!compact && <MemoryUsageBar snapshot={snapshot} />}
			<span className='memory-size-label'>{sizeLabel}</span>
			<div className='memory-drop-down-arrow codicon codicon-positron-drop-down-arrow' />
		</div>
	);
};
