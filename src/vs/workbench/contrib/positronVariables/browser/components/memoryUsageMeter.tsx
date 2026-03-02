/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './memoryUsageMeter.css';

// React.
import { useEffect, useRef, useState } from 'react';

// Other dependencies.
import * as DOM from '../../../../../base/browser/dom.js';
import { localize } from '../../../../../nls.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ByteSize } from '../../../../../platform/files/common/files.js';
import { IMemoryUsageSnapshot } from '../../../../../platform/positronMemoryUsage/common/positronMemoryUsage.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { MemoryUsageDropdown } from './memoryUsageDropdown.js';
import { MemoryUsageBar } from './memoryUsageBar.js';

/**
 * MemoryUsageMeter component.
 * Renders a segmented memory bar in the Variables pane action bar.
 */
export const MemoryUsageMeter = () => {
	// Services.
	const services = usePositronReactServicesContext();

	// State.
	const [snapshot, setSnapshot] = useState<IMemoryUsageSnapshot | undefined>(
		() => services.positronMemoryUsageService.currentSnapshot
	);

	// Ref for the meter element (used for popup anchoring).
	const meterRef = useRef<HTMLDivElement>(undefined!);

	// Subscribe to memory usage updates.
	useEffect(() => {
		const disposables = new DisposableStore();
		disposables.add(services.positronMemoryUsageService.onDidUpdateMemoryUsage(s => {
			setSnapshot(s);
		}));
		return () => disposables.dispose();
	}, [services.positronMemoryUsageService]);

	// If no data yet, don't render.
	if (!snapshot) {
		return null;
	}

	const { totalSystemMemory, kernelTotalBytes, positronOverheadBytes } = snapshot;

	// Positron's total footprint for the label.
	const positronTotalBytes = kernelTotalBytes + positronOverheadBytes;
	const sizeLabel = ByteSize.formatSize(positronTotalBytes);

	// Tooltip text.
	const tooltipText = localize(
		'positron.memoryUsage.tooltip',
		"Kernels: {0} | Positron: {1} | Other: {2} | Free: {3}",
		ByteSize.formatSize(kernelTotalBytes),
		ByteSize.formatSize(positronOverheadBytes),
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
				onDidUpdateMemoryUsage={services.positronMemoryUsageService.onDidUpdateMemoryUsage}
				renderer={renderer}
				snapshot={snapshot}
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
			<MemoryUsageBar snapshot={snapshot} />
			<span className='memory-size-label'>{sizeLabel}</span>
			<div className='memory-drop-down-arrow codicon codicon-positron-drop-down-arrow' />
		</div>
	);
};
