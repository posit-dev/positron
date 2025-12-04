/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './SpinningSquares.css';

// React.
import React, { useRef, useState, useCallback, useEffect } from 'react';

// Other dependencies.
import * as DOM from '../../../../../base/browser/dom.js';
import { Popover } from '../../../../browser/positronComponents/popover/popover.js';
import { useNotebookInstance } from '../NotebookInstanceProvider.js';
import { useObservedValue } from '../useObservedValue.js';

/**
 * Props for the SpinningSquares component.
 * Currently, the component accepts no props, but this interface is provided
 * for future extensibility.
 */
export interface ISpinningSquaresProps {
	// No props currently, but interface provided for future use
}

/**
 * SpinningSquares component that displays two animated squares.
 *
 * Features:
 * - Two squares with theme-derived colors that rotate around a center point
 * - Sticky positioned in the bottom right corner of the notebook
 * - Continuous rotation animation
 * - Colors adapt to the current VS Code theme
 *
 * @returns A React component displaying the spinning squares animation positioned in the bottom right.
 */
const POPUP_DELAY = 100;

export function SpinningSquares(_props?: ISpinningSquaresProps): React.ReactElement | null {
	// Get notebook instance and observe assistant working state
	const notebookInstance = useNotebookInstance();
	const assistantWorking = useObservedValue(notebookInstance.assistantWorking);

	// Animation configuration constants
	const speed = 4;
	const offset = 3;
	const counterRotate = true;

	// Reference hooks (must be called before any conditional returns)
	const containerRef = useRef<HTMLDivElement>(null);
	const hoverTimeoutIdRef = useRef<number | null>(null);

	// State hooks (must be called before any conditional returns)
	const [showPopup, setShowPopup] = useState(false);

	// Mouse hover handlers for popup
	const handleMouseEnter = useCallback(() => {
		if (!showPopup && containerRef.current) {
			const targetWindow = DOM.getWindow(containerRef.current);
			const timeoutId = targetWindow.setTimeout(() => {
				setShowPopup(true);
			}, POPUP_DELAY);

			hoverTimeoutIdRef.current = timeoutId;
		}
	}, [showPopup]);

	const handleMouseLeave = useCallback(() => {
		// Clear the hover timeout if we leave before the popup shows
		if (hoverTimeoutIdRef.current !== null && containerRef.current) {
			const targetWindow = DOM.getWindow(containerRef.current);
			targetWindow.clearTimeout(hoverTimeoutIdRef.current);
			hoverTimeoutIdRef.current = null;
		}
		// Note: The popup will handle its own auto-close behavior
	}, []);

	// Clean up timeout on unmount
	useEffect(() => {
		const containerElement = containerRef.current;
		return () => {
			if (hoverTimeoutIdRef.current !== null && containerElement) {
				const targetWindow = DOM.getWindow(containerElement);
				targetWindow.clearTimeout(hoverTimeoutIdRef.current);
			}
		};
	}, []);

	// Don't render if assistant is not working
	if (!assistantWorking) {
		return null;
	}

	// Dynamic styles for the animated squares
	const cyanSquareStyle: React.CSSProperties = {
		animation: `spin-cw ${speed}s linear infinite`,
	};

	const pinkSquareStyle: React.CSSProperties = {
		animation: `${counterRotate ? 'spin-ccw' : 'spin-cw'} ${speed}s linear infinite`,
	};

	const cyanWrapperStyle: React.CSSProperties = {
		transform: `translateX(${offset}px)`,
	};

	const pinkWrapperStyle: React.CSSProperties = {
		transform: `translateX(-${offset}px)`,
	};

	return (
		<>
			<div
				ref={containerRef}
				className='spinning-squares-container'
				onMouseEnter={handleMouseEnter}
				onMouseLeave={handleMouseLeave}
			>
				<div className='spinning-squares-spinner-container'>
					<div className='spinning-squares-square-wrapper' style={cyanWrapperStyle}>
						<div
							className='spinning-squares-square-cyan'
							style={cyanSquareStyle}
						/>
					</div>
					<div className='spinning-squares-square-wrapper' style={pinkWrapperStyle}>
						<div
							className='spinning-squares-square-pink'
							style={pinkSquareStyle}
						/>
					</div>
				</div>
			</div>
			{showPopup && containerRef.current && (
				<Popover
					anchorElement={containerRef.current}
					autoCloseDelay={POPUP_DELAY}
					autoCloseOnMouseLeave={true}
					onClose={() => setShowPopup(false)}
				>
					<div
						aria-label='Positron Assistant status'
						className='spinning-squares-popup'
						role='tooltip'
					>
						<div className='popup-row'>
							<span className='popup-label'>
								Positron Assistant is working on notebook
							</span>
						</div>
					</div>
				</Popover>
			)}
		</>
	);
}

