/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import React, { useEffect, useRef, useState, useCallback, PropsWithChildren } from 'react';
import './popover.css';

interface PopoverProps {
	/** Element to position the popover relative to */
	anchorElement: HTMLElement;
	/** Called when popover should close (click outside, Escape key, mouse leave) */
	onClose: () => void;
	/** Auto-close on mouse leave @default true */
	autoCloseOnMouseLeave?: boolean;
	/** Mouse leave delay in ms @default 250 */
	autoCloseDelay?: number;
	/** Additional CSS classes @default '' */
	className?: string;
	/** Spacing from anchor element in px @default 4 */
	offset?: number;
	/** Viewport edge margin in px @default 8 */
	viewportMargin?: number;
}

/**
 * Fixed-position popover that positions itself relative to an anchor element.
 * Automatically repositions to stay within viewport. Closes on click outside,
 * Escape key, or mouse leave.
 * 
 * **Note:** This is a pure React component that renders within the React tree,
 * so it's constrained by CSS overflow and z-index of parent containers. For
 * popovers that need to escape container boundaries, use modal dialogs instead.
 * 
 * @example
 * ```tsx
 * <Popover 
 *   anchorElement={buttonRef.current}
 *   onClose={() => setIsOpen(false)}
 * >
 *   Content
 * </Popover>
 * ```
 */
export function Popover({
	anchorElement,
	onClose,
	autoCloseOnMouseLeave = true,
	autoCloseDelay = 250,
	className = '',
	offset = 4,
	viewportMargin = 8,
	children
}: PropsWithChildren<PopoverProps>) {
	const popoverRef = useRef<HTMLDivElement>(null);
	const [position, setPosition] = useState({ top: 0, left: 0 });
	const closeTimeoutRef = useRef<number | null>(null);

	// Calculate position relative to anchor
	useEffect(() => {
		if (!popoverRef.current) {
			return;
		}

		const targetWindow = DOM.getWindow(popoverRef.current);
		const rect = anchorElement.getBoundingClientRect();
		const popoverRect = popoverRef.current.getBoundingClientRect();
		const windowWidth = targetWindow.innerWidth;
		const windowHeight = targetWindow.innerHeight;

		let top = rect.bottom + offset;
		let left = rect.left;

		// Adjust if popover would go off screen
		if (left + popoverRect.width > windowWidth) {
			left = windowWidth - popoverRect.width - viewportMargin;
		}
		if (top + popoverRect.height > windowHeight) {
			top = rect.top - popoverRect.height - offset;
		}

		setPosition({ top, left });
	}, [anchorElement, offset, viewportMargin]);

	// Handle auto-close on mouse leave
	const handleMouseEnter = useCallback(() => {
		if (closeTimeoutRef.current !== null) {
			const targetWindow = DOM.getWindow(anchorElement);
			targetWindow.clearTimeout(closeTimeoutRef.current);
			closeTimeoutRef.current = null;
		}
	}, [anchorElement]);

	const handleMouseLeave = useCallback(() => {
		if (autoCloseOnMouseLeave) {
			const targetWindow = DOM.getWindow(anchorElement);
			closeTimeoutRef.current = targetWindow.setTimeout(onClose, autoCloseDelay);
		}
	}, [autoCloseOnMouseLeave, autoCloseDelay, onClose, anchorElement]);

	// Monitor anchor element for mouse leave events
	useEffect(() => {
		if (!autoCloseOnMouseLeave) {
			return;
		}

		const handleAnchorMouseEnter = () => {
			if (closeTimeoutRef.current !== null) {
				const targetWindow = DOM.getWindow(anchorElement);
				targetWindow.clearTimeout(closeTimeoutRef.current);
				closeTimeoutRef.current = null;
			}
		};

		const handleAnchorMouseLeave = () => {
			const targetWindow = DOM.getWindow(anchorElement);
			closeTimeoutRef.current = targetWindow.setTimeout(onClose, autoCloseDelay);
		};

		anchorElement.addEventListener('mouseenter', handleAnchorMouseEnter);
		anchorElement.addEventListener('mouseleave', handleAnchorMouseLeave);

		return () => {
			anchorElement.removeEventListener('mouseenter', handleAnchorMouseEnter);
			anchorElement.removeEventListener('mouseleave', handleAnchorMouseLeave);
		};
	}, [anchorElement, autoCloseOnMouseLeave, autoCloseDelay, onClose]);

	// Clean up on unmount
	useEffect(() => {
		return () => {
			if (closeTimeoutRef.current !== null) {
				const targetWindow = DOM.getWindow(anchorElement);
				targetWindow.clearTimeout(closeTimeoutRef.current);
			}
		};
	}, [anchorElement]);

	// Close on escape key
	useEffect(() => {
		const targetWindow = DOM.getWindow(anchorElement);
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				onClose();
			}
		};

		targetWindow.addEventListener('keydown', handleKeyDown);
		return () => targetWindow.removeEventListener('keydown', handleKeyDown);
	}, [onClose, anchorElement]);

	// Close on click outside
	useEffect(() => {
		const targetWindow = DOM.getWindow(anchorElement);
		const handleClickOutside = (e: MouseEvent) => {
			if (popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
				!anchorElement.contains(e.target as Node)) {
				onClose();
			}
		};

		// Delay to avoid immediate close on open
		const timer = targetWindow.setTimeout(() => {
			targetWindow.document.addEventListener('mousedown', handleClickOutside);
		}, 0);

		return () => {
			targetWindow.clearTimeout(timer);
			targetWindow.document.removeEventListener('mousedown', handleClickOutside);
		};
	}, [anchorElement, onClose]);

	return (
		<div
			ref={popoverRef}
			className={`positron-popover ${className}`}
			style={{
				top: `${position.top}px`,
				left: `${position.left}px`
			}}
			onMouseEnter={handleMouseEnter}
			onMouseLeave={handleMouseLeave}
		>
			{children}
		</div>
	);
}
