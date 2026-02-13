/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

interface AnnouncerProps {
	message: string;
	assertive?: boolean;
}

/**
 * ARIA live region for screen reader announcements.
 * Changes to `message` will be announced automatically.
 */
export function Announcer({ message, assertive = false }: AnnouncerProps) {
	return (
		<div
			aria-atomic="true"
			aria-live={assertive ? 'assertive' : 'polite'}
			role="status"
			style={{
				position: 'absolute',
				width: '1px',
				height: '1px',
				padding: 0,
				margin: '-1px',
				overflow: 'hidden',
				clip: 'rect(0, 0, 0, 0)',
				whiteSpace: 'nowrap',
				border: 0,
			}}
		>
			{message}
		</div>
	);
}

/**
 * Generate announcement messages for drag events.
 */
export function getAnnouncement(
	event: 'start' | 'move' | 'end' | 'cancel',
	activeIndex: number,
	overIndex: number | null,
	totalItems: number
): string {
	switch (event) {
		case 'start':
			return `Picked up cell ${activeIndex + 1} of ${totalItems}. Drag to reorder, Escape to cancel.`;
		case 'move':
			if (overIndex === null) {
				return `Cell ${activeIndex + 1} is being dragged.`;
			}
			if (overIndex === activeIndex) {
				return `Cell is at its original position.`;
			}
			return `Cell ${activeIndex + 1} is over position ${overIndex + 1} of ${totalItems}.`;
		case 'end':
			if (overIndex === null || overIndex === activeIndex) {
				return `Cell ${activeIndex + 1} was dropped at its original position.`;
			}
			return `Cell was moved from position ${activeIndex + 1} to position ${overIndex + 1}.`;
		case 'cancel':
			return `Drag cancelled. Cell ${activeIndex + 1} returned to its original position.`;
	}
}
