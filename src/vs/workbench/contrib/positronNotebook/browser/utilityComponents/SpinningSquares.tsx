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
 * Gear component for the thinking robot animation.
 *
 * @param cx - Center X coordinate
 * @param cy - Center Y coordinate
 * @param size - Size of the gear
 * @param speed - Animation speed in seconds
 * @param direction - Rotation direction (1 for clockwise, -1 for counter-clockwise)
 * @param isThinking - Whether the animation should be active
 */
interface IGearProps {
	cx: number;
	cy: number;
	size: number;
	speed: number;
	direction: number;
	isThinking: boolean;
}

const Gear = ({ cx, cy, size, speed, direction, isThinking }: IGearProps) => {
	const animationName = direction > 0 ? 'spin' : 'spinReverse';
	const gearStyle: React.CSSProperties = {
		transformOrigin: `${cx}px ${cy}px`,
		animation: isThinking ? `${animationName} ${speed}s linear infinite` : 'none',
	};

	return (
		<g style={gearStyle}>
			{[...Array(8)].map((_, i) => (
				<rect
					key={i}
					fill='currentColor'
					height={size * 0.35}
					rx={size * 0.05}
					style={{
						transformOrigin: `${cx}px ${cy}px`,
						transform: `rotate(${i * 45}deg)`,
					}}
					width={size * 0.3}
					x={cx - size * 0.15}
					y={cy - size * 0.9}
				/>
			))}
			<circle cx={cx} cy={cy} fill='currentColor' r={size * 0.55}
			/>
			<circle cx={cx} cy={cy} fill='var(--vscode-editor-background)' r={size * 0.25} />
		</g>
	);
};

/**
 * SpinningSquares component that displays a thinking robot animation.
 *
 * Features:
 * - Three animated gears at the top (different sizes, speeds, directions)
 * - Robot face with pulsing dots indicating thinking state
 * - Sticky positioned in the bottom right corner of the notebook
 * - Continuous rotation animation when assistant is working
 * - Colors adapt to the current VS Code theme
 *
 * @returns A React component displaying the thinking robot animation positioned in the bottom right.
 */
const POPUP_DELAY = 100;

export function SpinningSquares(_props?: ISpinningSquaresProps): React.ReactElement | null {
	// Get notebook instance and observe assistant working state
	const notebookInstance = useNotebookInstance();
	const assistantWorking = useObservedValue(notebookInstance.assistantWorking);

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

	// Only show animation when assistant is working
	if (!assistantWorking) {
		return null;
	}

	// Styles for pulsing dots - animated when assistant is working
	const dot1Style: React.CSSProperties = {
		animation: 'pulse 1.2s ease-in-out infinite 0s',
	};

	const dot2Style: React.CSSProperties = {
		animation: 'pulse 1.2s ease-in-out infinite 0.2s',
	};

	const dot3Style: React.CSSProperties = {
		animation: 'pulse 1.2s ease-in-out infinite 0.4s',
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
					<svg
						className='thinking-robot-svg'
						fill='currentColor'
						viewBox='-2 -6 20 24'
						xmlns='http://www.w3.org/2000/svg'
					>
						<g>
							<Gear cx={11} cy={-1} direction={1} isThinking={assistantWorking} size={3} speed={2} />
							<Gear cx={8} cy={-2.5} direction={-1} isThinking={assistantWorking} size={2.5} speed={1.5} />
							<Gear cx={5} cy={-0.5} direction={1} isThinking={assistantWorking} size={2.8} speed={1.8} />
						</g>

						<g className={assistantWorking ? 'robot-body' : ''} transform='translate(0, 2)'>
							<path d='M11,14.6h-6c-2,0-3.6-1.6-3.6-3.5v-5.9c0-2,1.6-3.5,3.6-3.5h6c2,0,3.6,1.6,3.6,3.5v5.9c0,2-1.6,3.5-3.6,3.5ZM5,2.9c-1.3,0-2.4,1-2.4,2.3v5.9c0,1.3,1.1,2.3,2.4,2.3h6c1.3,0,2.4-1,2.4-2.3v-5.9c0-1.3-1.1-2.3-2.4-2.3h-6Z' />
							<path d='M10.5,8.5c-1.1,0-2-.9-2-2s.9-2,2-2,2,.9,2,2-.9,2-2,2ZM10.5,5.2c-.7,0-1.2.6-1.2,1.2s.6,1.2,1.2,1.2,1.2-.6,1.2-1.2-.6-1.2-1.2-1.2Z' />
							<path d='M5.5,8.5c-1.1,0-2-.9-2-2s.9-2,2-2,2,.9,2,2-.9,2-2,2ZM5.5,5.2c-.7,0-1.2.6-1.2,1.2s.6,1.2,1.2,1.2,1.2-.6,1.2-1.2-.6-1.2-1.2-1.2Z' />
							{/* Pupils - small circles inside eyes that track left/right */}
							<circle className={assistantWorking ? 'robot-pupil' : ''} cx='5.5' cy='6.5' r='0.3' />
							<circle className={assistantWorking ? 'robot-pupil' : ''} cx='10.5' cy='6.5' r='0.3' />
							<rect height='1' width='2' x='2' y='6' />
							<rect height='1' width='2' x='12' y='6' />
							<path d='M14,6.5h.5c.6,0,1,.4,1,1v1c0,.6-.4,1-1,1h-.5v-3h0Z' />
							<path d='M.5,6.5h.5c.6,0,1,.4,1,1v1c0,.6-.4,1-1,1h-.5v-3h0Z' transform='translate(2.5 16) rotate(-180)' />
							<rect height='1' width='2' x='7' y='5.5' />
							<circle cx='6.5' cy='10.9' r='.6' style={dot1Style} />
							<circle cx='8' cy='11.1' r='.6' style={dot2Style} />
							<circle cx='9.5' cy='10.8' r='.6' style={dot3Style} />
						</g>
					</svg>
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

