/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *  Positron API Runtime Function
 *  Generated from source TypeScript definitions
 *
 *  This file provides a safe runtime function to access the Positron API.
 *--------------------------------------------------------------------------------------------*/

// Import types from the ambient module declaration
import type * as positron from 'positron';

// The key insight - this captures the complete API shape
export type PositronApi = typeof positron;


/**
 * Check if the current environment is Positron.
 *
 * This is a simple helper function that returns true if running in Positron,
 * false if running in VS Code.
 *
 * @returns true if running in Positron, false otherwise
 *
 * @example
 * ```typescript
 * import { inPositron } from '@posit-dev/positron';
 *
 * if (inPositron()) {
 *   // We're in Positron - use enhanced features
 *   console.log('Running in Positron!');
 * } else {
 *   // We're in VS Code - use standard functionality
 *   console.log('Running in VS Code mode');
 * }
 * ```
 */
export function inPositron(): boolean {
	return typeof globalThis !== 'undefined' &&
		typeof (globalThis as any).acquirePositronApi === 'function';
}

/**
 * Safely acquire the Positron API if running in Positron, or return undefined if running in VS Code.
 *
 * This function handles the detection of whether the extension is running in Positron or VS Code,
 * and provides access to Positron-specific functionality when available.
 *
 * @returns The Positron API object if available, or undefined if running in VS Code
 *
 * @example
 * ```typescript
 * import { tryAcquirePositronApi } from '@posit-dev/positron/runtime';
 *
 * const positronApi = tryAcquirePositronApi();
 * if (positronApi) {
 *   // We're in Positron - use enhanced features
 *   positronApi.runtime.executeCode('python', 'print("Hello Positron!")', true);
 * } else {
 *   // We're in VS Code - use standard functionality
 *   console.log('Running in VS Code mode');
 * }
 * ```
 */
export function tryAcquirePositronApi(): PositronApi | undefined {
	try {
		// Check if we're running in Positron by looking for the global acquirePositronApi function
		if (inPositron()) {
			return (globalThis as any).acquirePositronApi();
		}
		return undefined;
	} catch (error) {
		// If any error occurs (e.g., acquirePositronApi throws), return undefined
		// This ensures extensions gracefully degrade to VS Code mode
		return undefined;
	}
}