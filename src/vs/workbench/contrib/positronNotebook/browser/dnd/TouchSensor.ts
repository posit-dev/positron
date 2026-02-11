/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns, local/code-amd-node-module
import * as React from 'react';
import * as DOM from '../../../../../base/browser/dom.js';

export interface TouchSensorConfig {
	activationDelay?: number;      // ms before drag activates (default: 250)
	activationDistance?: number;   // px movement to cancel delay (default: 5)
}

const DEFAULT_CONFIG: Required<TouchSensorConfig> = {
	activationDelay: 250,
	activationDistance: 5,
};

/**
 * Touch sensor for drag-and-drop on touch devices.
 * Uses a long-press activation to distinguish from scroll gestures.
 */
export function useTouchSensor(
	onActivate: (position: { x: number; y: number }) => void,
	config: TouchSensorConfig = {}
) {
	const { activationDelay, activationDistance } = { ...DEFAULT_CONFIG, ...config };
	const timeoutRef = React.useRef<number | null>(null);
	const startPositionRef = React.useRef<{ x: number; y: number } | null>(null);

	const clearTimeout = React.useCallback(() => {
		if (timeoutRef.current) {
			DOM.getActiveWindow().clearTimeout(timeoutRef.current);
			timeoutRef.current = null;
		}
	}, []);

	const handleTouchStart = React.useCallback((e: React.TouchEvent) => {
		if (e.touches.length !== 1) {
			return; // Only handle single touch
		}

		const touch = e.touches[0];
		startPositionRef.current = { x: touch.clientX, y: touch.clientY };

		// Start activation delay
		const targetWindow = DOM.getActiveWindow();
		timeoutRef.current = targetWindow.setTimeout(() => {
			if (startPositionRef.current) {
				onActivate(startPositionRef.current);
			}
		}, activationDelay);
	}, [activationDelay, onActivate]);

	const handleTouchMove = React.useCallback((e: React.TouchEvent) => {
		if (!startPositionRef.current || e.touches.length !== 1) {
			return;
		}

		const touch = e.touches[0];
		const distance = Math.sqrt(
			Math.pow(touch.clientX - startPositionRef.current.x, 2) +
			Math.pow(touch.clientY - startPositionRef.current.y, 2)
		);

		// Cancel activation if moved too far (user is scrolling)
		if (distance > activationDistance) {
			clearTimeout();
		}
	}, [activationDistance, clearTimeout]);

	const handleTouchEnd = React.useCallback(() => {
		clearTimeout();
		startPositionRef.current = null;
	}, [clearTimeout]);

	// Cleanup on unmount
	React.useEffect(() => {
		return () => {
			clearTimeout();
		};
	}, [clearTimeout]);

	return {
		onTouchStart: handleTouchStart,
		onTouchMove: handleTouchMove,
		onTouchEnd: handleTouchEnd,
		onTouchCancel: handleTouchEnd,
	};
}
