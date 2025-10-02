/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './KernelStatusTooltip.css';

// React.
import React, { useEffect, useRef, useState } from 'react';

// Other dependencies.
import { IRuntimeDisplayInfo } from './IPositronNotebookInstance.js';

interface KernelStatusTooltipProps {
	/** Runtime information to display */
	info: IRuntimeDisplayInfo;
	/** The badge element to anchor the tooltip to */
	anchorElement: HTMLElement;
	/** Whether the tooltip should be visible */
	visible: boolean;
}

/**
 * Rich hover tooltip displaying detailed kernel/runtime information.
 * Positioned relative to the badge with automatic above/below placement.
 */
export function KernelStatusTooltip({ info, anchorElement, visible }: KernelStatusTooltipProps) {
	const tooltipRef = useRef<HTMLDivElement>(null);
	const [position, setPosition] = useState<'above' | 'below'>('below');

	// Calculate optimal tooltip position based on viewport space
	useEffect(() => {
		if (!tooltipRef.current || !anchorElement) {
			return;
		}

		const anchorRect = anchorElement.getBoundingClientRect();
		const tooltipHeight = tooltipRef.current.offsetHeight;
		const viewportHeight = window.innerHeight;

		// Prefer showing below, but show above if there's not enough space below
		const spaceBelow = viewportHeight - anchorRect.bottom;
		const spaceAbove = anchorRect.top;

		if (spaceBelow < tooltipHeight && spaceAbove > spaceBelow) {
			setPosition('above');
		} else {
			setPosition('below');
		}
	}, [anchorElement, visible]);

	// Get state color class for visual indicator
	const getStateColorClass = (state: string): string => {
		const lowerState = state.toLowerCase();
		if (lowerState.includes('idle') || lowerState.includes('ready')) {
			return 'state-ready';
		} else if (lowerState.includes('busy')) {
			return 'state-busy';
		} else if (lowerState.includes('starting') || lowerState.includes('initializing')) {
			return 'state-starting';
		} else if (lowerState.includes('offline') || lowerState.includes('exited') || lowerState.includes('disconnected')) {
			return 'state-offline';
		}
		return 'state-unknown';
	};

	if (!visible) {
		return null;
	}

	return (
		<div
			ref={tooltipRef}
			aria-live="polite"
			className={`kernel-status-tooltip ${position}`}
			role="tooltip"
		>
			<div className="tooltip-content">
				{/* Runtime name header */}
				<div className="tooltip-header">
					{info.runtimeName}
				</div>

				{/* Divider */}
				<div className="tooltip-divider" />

				{/* Current state with visual indicator */}
				<div className="tooltip-row">
					<span className="tooltip-label">State:</span>
					<span className={`tooltip-value state-indicator ${getStateColorClass(info.state)}`}>
						<span className="state-dot" />
						{info.state}
					</span>
				</div>

				{/* Session ID */}
				<div className="tooltip-row">
					<span className="tooltip-label">Session:</span>
					<span className="tooltip-value tooltip-monospace">
						{info.sessionId.slice(0, 16)}...
					</span>
				</div>

				{/* Divider */}
				<div className="tooltip-divider" />

				{/* Language version */}
				<div className="tooltip-row">
					<span className="tooltip-label">Version:</span>
					<span className="tooltip-value">
						{info.languageVersion}
					</span>
				</div>

				{/* Runtime path */}
				<div className="tooltip-row">
					<span className="tooltip-label">Path:</span>
					<span className="tooltip-value tooltip-path">
						{info.runtimePath}
					</span>
				</div>

				{/* Runtime source */}
				<div className="tooltip-row">
					<span className="tooltip-label">Source:</span>
					<span className="tooltip-value">
						{info.runtimeSource}
					</span>
				</div>

				{/* Implementation version (if available) */}
				{info.implementationVersion && (
					<div className="tooltip-row">
						<span className="tooltip-label">Implementation:</span>
						<span className="tooltip-value tooltip-monospace">
							{info.implementationVersion}
						</span>
					</div>
				)}
			</div>
		</div>
	);
}
