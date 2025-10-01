/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React from 'react';

/**
 * Props for the ScreenReaderOnly component
 */
interface ScreenReaderOnlyProps {
	/** Content to be announced to screen readers but hidden visually */
	children: React.ReactNode;
	/** ARIA live region politeness level. Default: 'polite' */
	ariaLive?: 'off' | 'polite' | 'assertive';
	/** Whether changes to the region should be presented atomically. Default: true */
	ariaAtomic?: boolean;
	/** Additional className for custom styling */
	className?: string;
}

/**
 * Component that renders content visible only to screen readers.
 * Uses the industry-standard off-screen positioning technique recommended by WebAIM.
 *
 * Typically used for ARIA live regions to announce dynamic content changes.
 *
 * @example
 * ```tsx
 * <ScreenReaderOnly ariaLive="polite">
 *   Cell 1 of 5 selected
 * </ScreenReaderOnly>
 * ```
 */
export function ScreenReaderOnly({
	children,
	ariaLive = 'polite',
	ariaAtomic = true,
	className = ''
}: ScreenReaderOnlyProps) {
	return (
		<div
			aria-atomic={ariaAtomic}
			aria-live={ariaLive}
			className={className}
			role="status"
			style={{
				position: 'absolute',
				left: '-10000px',
				width: '1px',
				height: '1px',
				overflow: 'hidden'
			}}
		>
			{children}
		</div>
	);
}
