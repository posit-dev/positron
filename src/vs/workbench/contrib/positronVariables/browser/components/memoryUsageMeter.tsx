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
import { ActionBarSeparator } from '../../../../../platform/positronActionBar/browser/components/actionBarSeparator.js';

/** Minimum bar width in pixels before the bar is hidden entirely. */
const MIN_BAR_WIDTH = 50;

/**
 * MemoryUsageMeter component.
 * Renders a segmented memory bar in the Variables pane action bar.
 * Responsively hides the bar when the container is too narrow.
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

	// Ref for the bar container element (used for resize observation).
	const barContainerRef = useRef<HTMLDivElement>(null);

	// Subscribe to memory usage updates.
	useEffect(() => {
		const disposables = new DisposableStore();
		disposables.add(services.positronMemoryUsageService.onDidUpdateMemoryUsage(s => {
			setSnapshot(s);
		}));
		return () => disposables.dispose();
	}, [services.positronMemoryUsageService]);

	// Re-attach the observer when the component first renders with data.
	const hasSnapshot = snapshot !== undefined;

	// Observe the meter element to toggle bar visibility. The bar is always
	// in the DOM; when the meter is too narrow for it, we add display:none
	// via a CSS class. We observe the meter (which has flex:1 and a stable
	// width from the action bar region) to avoid the collapse feedback loop
	// that would occur if we observed the bar container directly.
	useEffect(() => {
		const meter = meterRef.current;
		const barContainer = barContainerRef.current;
		if (!meter || !barContainer) {
			return;
		}

		const update = () => {
			const isHidden = barContainer.classList.contains('memory-bar-hidden');

			// Measure the meter's inner width and the fixed children.
			const meterWidth = meter.clientWidth;
			const targetWindow = DOM.getWindow(meter);
			const meterStyle = targetWindow.getComputedStyle(meter);
			const meterGap = parseFloat(meterStyle.gap) || 0;
			const meterPadding =
				parseFloat(meterStyle.paddingLeft) + parseFloat(meterStyle.paddingRight);

			// Sum widths of all meter children except the bar container.
			let fixedChildrenWidth = 0;
			for (const child of meter.children) {
				if (child !== barContainer) {
					fixedChildrenWidth += child.getBoundingClientRect().width;
				}
			}

			// When bar is visible: 3 children = 2 gaps.
			// When bar is hidden: 2 children = 1 gap.
			const gapCount = isHidden ? 1 : 2;
			const totalGaps = meterGap * gapCount;

			const availableForBar =
				meterWidth - fixedChildrenWidth - totalGaps - meterPadding;

			if (isHidden && availableForBar >= MIN_BAR_WIDTH) {
				barContainer.classList.remove('memory-bar-hidden');
			} else if (!isHidden && availableForBar < MIN_BAR_WIDTH) {
				barContainer.classList.add('memory-bar-hidden');
			}
		};

		const observer = new ResizeObserver(update);
		observer.observe(meter);
		return () => observer.disconnect();
	}, [hasSnapshot]);

	// If no data yet, don't render.
	if (!snapshot) {
		return null;
	}

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
		<>
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
				<MemoryUsageBar ref={barContainerRef} snapshot={snapshot} />
				<span className='memory-size-label'>{sizeLabel}</span>
				<div className='memory-drop-down-arrow codicon codicon-positron-drop-down-arrow' />
			</div>
			<ActionBarSeparator />
		</>
	);
};
