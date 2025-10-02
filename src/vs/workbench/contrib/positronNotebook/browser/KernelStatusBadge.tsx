/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './KernelStatusBadge.css';

// React.
import React, { useRef, useState } from 'react';

// Other dependencies.
import { useNotebookInstance } from './NotebookInstanceProvider.js';
import { useObservedValue } from './useObservedValue.js';
import { SELECT_KERNEL_ID_POSITRON } from './SelectPositronNotebookKernelAction.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';
import { KernelStatusTooltip } from './KernelStatusTooltip.js';

// This component displays the current kernel's language and connection status.
// It shows the language name (e.g., "Python", "R") and the current status state.
// Clicking the badge opens the kernel picker to select a different kernel.
// Hovering shows a rich tooltip with detailed runtime information.
export function KernelStatusBadge() {
	const notebookInstance = useNotebookInstance();
	const kernelStatus = useObservedValue(notebookInstance.kernelStatus);
	const runtimeInfo = useObservedValue(notebookInstance.runtimeInfo);
	const services = usePositronReactServicesContext();

	// State for tooltip visibility
	const [showTooltip, setShowTooltip] = useState(false);
	const badgeRef = useRef<HTMLDivElement>(null);
	const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Handle mouse enter with slight delay to prevent flickering
	const handleMouseEnter = () => {
		// Clear any pending hide timeout
		if (hoverTimeoutRef.current) {
			clearTimeout(hoverTimeoutRef.current);
			hoverTimeoutRef.current = null;
		}

		// Show tooltip after short delay
		hoverTimeoutRef.current = setTimeout(() => {
			setShowTooltip(true);
		}, 300); // 300ms delay before showing
	};

	// Handle mouse leave with slight delay for smooth transition
	const handleMouseLeave = () => {
		// Clear any pending show timeout
		if (hoverTimeoutRef.current) {
			clearTimeout(hoverTimeoutRef.current);
			hoverTimeoutRef.current = null;
		}

		// Hide tooltip after short delay
		hoverTimeoutRef.current = setTimeout(() => {
			setShowTooltip(false);
		}, 100); // 100ms delay before hiding
	};

	// Display language name or fallback to "Kernel"
	const displayName = runtimeInfo?.languageName ?? 'Kernel';

	// Format simple fallback tooltip for native title attribute
	const nativeTitleTooltip = !runtimeInfo
		? 'No kernel connected'
		: `${displayName} ${kernelStatus}`;

	return (
		<div
			ref={badgeRef}
			aria-label={`Notebook kernel: ${displayName} - ${kernelStatus}`}
			className='positron-notebook-kernel-status-badge'
			role='button'
			tabIndex={0}
			title={nativeTitleTooltip}
			onClick={() => services.commandService.executeCommand(SELECT_KERNEL_ID_POSITRON, { forceDropdown: true })}
			onMouseEnter={handleMouseEnter}
			onMouseLeave={handleMouseLeave}
		>
			{displayName}
			<span className={`kernel-status ${kernelStatus}`}>{' ' + kernelStatus}</span>

			{/* Rich tooltip - only shown when runtime info is available and hover is active */}
			{runtimeInfo && badgeRef.current && (
				<KernelStatusTooltip
					anchorElement={badgeRef.current}
					info={runtimeInfo}
					visible={showTooltip}
				/>
			)}
		</div>
	);
}
