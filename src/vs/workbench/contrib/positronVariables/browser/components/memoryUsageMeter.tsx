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
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { ByteSize } from '../../../../../platform/files/common/files.js';
import { formatCompactMemory, IMemoryUsageSnapshot, LowMemoryUnit } from '../../../../../platform/positronMemoryUsage/common/positronMemoryUsage.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { usePositronActionBarContext } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { PositronModalPopup } from '../../../../browser/positronComponents/positronModalPopup/positronModalPopup.js';
import { MemoryUsageDropdown } from './memoryUsageDropdown.js';
import { MemoryUsageBar } from './memoryUsageBar.js';

/**
 * The fixed-width portion of the meter when the bar is present, excluding the
 * bar itself and the dynamic size label text.
 *
 * gap(6) + gap(6) + arrow(14) + padding(4+4) = 34
 */
export const MEMORY_METER_CHROME_WIDTH = 34;

/**
 * The fixed-width portion of the meter when the bar is omitted (label + arrow
 * only), excluding the dynamic size label text.
 *
 * gap(6) + arrow(14) + padding(4+4) = 28
 */
export const MEMORY_METER_NO_BAR_WIDTH = 28;

/**
 * The bar's maximum width (when the action bar has ample space).
 */
export const MEMORY_BAR_MAX_WIDTH = 100;

/**
 * The bar's minimum width before the caller should fall back to a label-only
 * meter (no bar).
 */
export const MEMORY_BAR_MIN_WIDTH = 27;

/**
 * The extra width consumed by the low-memory warning icon (icon + gap) when
 * the meter is in a low-memory state.
 */
export const MEMORY_METER_WARNING_WIDTH = 20;

/**
 * The label shown while memory data is still being computed.
 */
const memLabel = localize('positron.memoryUsage.memLabel', "Mem");

/**
 * The text shown in the loading dropdown popup.
 */
const computingLabel = localize('positron.memoryUsage.computing', "Computing memory usage...");

/**
 * MemoryUsageMeterProps interface.
 */
interface MemoryUsageMeterProps {
	snapshot?: IMemoryUsageSnapshot;
	/**
	 * Width of the segmented bar, in px. Scales between MEMORY_BAR_MIN_WIDTH
	 * and MEMORY_BAR_MAX_WIDTH. Omit to render a label-only meter (no bar) for
	 * very narrow layouts.
	 */
	barWidth?: number;
	loading?: boolean;
	/**
	 * Whether to render the low-memory warning icon when the system is low on
	 * memory. Defaults to true; the caller sets this to false at very narrow
	 * widths so the size label can be kept when the icon no longer fits.
	 */
	showWarning?: boolean;
}

/**
 * MemoryUsageMeter component.
 * Renders a segmented memory bar in the Variables pane action bar.
 * Layout and overflow are handled by the parent PositronDynamicActionBar.
 *
 * When `loading` is true, renders an empty bar with a "Mem" label. Clicking
 * in this state shows a popup with a "Computing memory usage..." message.
 */
export const MemoryUsageMeter = ({ snapshot, barWidth, loading, showWarning = true }: MemoryUsageMeterProps) => {
	// Services.
	const services = usePositronReactServicesContext();
	const actionBarContext = usePositronActionBarContext();

	// Ref for the meter element (used for popup anchoring).
	const meterRef = useRef<HTMLDivElement>(undefined!);

	// Ref for the low-memory warning icon (used as a distinct hover target).
	const warningRef = useRef<HTMLDivElement>(null);

	// Track mouse-inside state so we can show/hide the hover tooltip via the
	// action bar's hover manager, consistent with other action bar widgets.
	const [mouseInside, setMouseInside] = useState(false);

	// Track whether the mouse is over the warning icon specifically, so its
	// tooltip takes precedence over the meter's tooltip.
	const [warningHover, setWarningHover] = useState(false);

	// Compute the tooltip text based on the current state.
	const tooltipText = (loading || !snapshot)
		? computingLabel
		: localize(
			'positron.memoryUsage.tooltip',
			"Kernels: {0} | Positron: {1} | Other: {2} | Free: {3}",
			ByteSize.formatSize(snapshot.kernelTotalBytes),
			ByteSize.formatSize(snapshot.positronOverheadBytes + snapshot.extensionHostOverheadBytes),
			ByteSize.formatSize(snapshot.otherProcessesBytes),
			ByteSize.formatSize(snapshot.freeSystemMemory)
		);

	// Compute the low-memory warning tooltip, reporting remaining memory in the
	// unit of the threshold that triggered the warning.
	const lowMemory = snapshot?.lowMemory;
	const lowMemoryTooltip = lowMemory
		? (lowMemory.unit === LowMemoryUnit.Percent
			? localize('positron.memoryUsage.lowMemoryPercent', "Low memory ({0}% remaining)", Math.max(0, Math.round(lowMemory.remaining)))
			: localize('positron.memoryUsage.lowMemoryMb', "Low memory ({0}MB remaining)", Math.max(0, Math.round(lowMemory.remaining))))
		: undefined;

	// Show/hide hover tooltip via the action bar hover manager. The warning
	// icon's tooltip takes precedence when the mouse is over it.
	useEffect(() => {
		if (warningHover && warningRef.current && lowMemoryTooltip) {
			actionBarContext.hoverManager?.showHover(warningRef.current, lowMemoryTooltip);
		} else if (mouseInside) {
			actionBarContext.hoverManager?.showHover(meterRef.current, tooltipText);
		}
	}, [warningHover, mouseInside, actionBarContext.hoverManager, tooltipText, lowMemoryTooltip]);

	const onMouseEnter = () => setMouseInside(true);
	const onMouseLeave = () => setMouseInside(false);

	// The low-memory warning icon, rendered to the left of the bar when the
	// system is low on memory. Hooks above run unconditionally; this element is
	// shared between the loading and loaded render paths.
	const warningIcon = (showWarning && lowMemoryTooltip) ? (
		<div
			ref={warningRef}
			aria-label={lowMemoryTooltip}
			className='memory-low-warning codicon codicon-warning'
			role='img'
			onMouseEnter={() => setWarningHover(true)}
			onMouseLeave={() => setWarningHover(false)}
		/>
	) : null;

	// When the meter is too narrow to show the warning icon, color the size
	// label with the warning foreground so the low-memory state is still
	// indicated.
	const lowMemoryLabel = !!lowMemory && !showWarning;

	// Loading state: draw an empty bar with a "Mem" label.
	if (loading || !snapshot) {
		const handleLoadingClick = () => {
			if (!meterRef.current) {
				return;
			}

			actionBarContext.hoverManager?.hideHover();

			const renderer = new PositronModalReactRenderer({
				container: services.workbenchLayoutService.getContainer(DOM.getWindow(meterRef.current)),
				parent: meterRef.current,
			});

			renderer.render(
				<MemoryUsageLoadingDropdown
					anchorElement={meterRef.current}
					renderer={renderer}
				/>
			);
		};

		return (
			<div
				ref={meterRef}
				aria-label={computingLabel}
				className='memory-usage-meter'
				role='meter'
				onClick={handleLoadingClick}
				onMouseEnter={onMouseEnter}
				onMouseLeave={onMouseLeave}
			>
				{barWidth !== undefined && (
					<div className='memory-bar-container' style={{ width: barWidth }}>
						{/* Empty bar -- no segments */}
					</div>
				)}
				<span className='memory-size-label'>{memLabel}</span>
				<div className='memory-drop-down-arrow codicon codicon-positron-drop-down-arrow' />
			</div>
		);
	}

	const { totalSystemMemory, kernelTotalBytes, positronOverheadBytes, extensionHostOverheadBytes } = snapshot;

	// Positron's total footprint for the label. Use the compact formatter so the
	// label fits in 3-4 characters and doesn't shift the action bar layout.
	const positronTotalBytes = kernelTotalBytes + positronOverheadBytes + extensionHostOverheadBytes;
	const sizeLabel = formatCompactMemory(positronTotalBytes);

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

		actionBarContext.hoverManager?.hideHover();

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
			onClick={handleClick}
			onMouseEnter={onMouseEnter}
			onMouseLeave={onMouseLeave}
		>
			{warningIcon}
			{barWidth !== undefined && (
				<MemoryUsageBar snapshot={snapshot} style={{ width: barWidth }} />
			)}
			<span className={positronClassNames('memory-size-label', { 'low-memory': lowMemoryLabel })}>{sizeLabel}</span>
			<div className='memory-drop-down-arrow codicon codicon-positron-drop-down-arrow' />
		</div>
	);
};

/**
 * MemoryUsageLoadingDropdown props.
 */
interface MemoryUsageLoadingDropdownProps {
	anchorElement: HTMLElement;
	renderer: PositronModalReactRenderer;
}

/**
 * MemoryUsageLoadingDropdown component.
 * Renders a simple popup indicating that memory usage is being computed.
 */
const MemoryUsageLoadingDropdown = (props: MemoryUsageLoadingDropdownProps) => {
	return (
		<PositronModalPopup
			anchorElement={props.anchorElement}
			fixedHeight={true}
			height='auto'
			keyboardNavigationStyle='dialog'
			popupAlignment='right'
			popupPosition='bottom'
			renderer={props.renderer}
			width='auto'
		>
			<div className='memory-usage-loading-message'>
				{computingLabel}
			</div>
		</PositronModalPopup>
	);
};
