"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPositronApi = getPositronApi;
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
 * import { getPositronApi } from '@posit-dev/positron';
 *
 * const positronApi = getPositronApi();
 * if (positronApi) {
 *   // We're in Positron - use enhanced features
 *   positronApi.runtime.executeCode('python', 'print("Hello Positron!")', true);
 * } else {
 *   // We're in VS Code - use standard functionality
 *   console.log('Running in VS Code mode');
 * }
 * ```
 */
function getPositronApi() {
    try {
        // Check if we're running in Positron by looking for the global acquirePositronApi function
        if (typeof globalThis !== 'undefined' &&
            typeof globalThis.acquirePositronApi === 'function') {
            return globalThis.acquirePositronApi();
        }
        return undefined;
    }
    catch (error) {
        // If any error occurs (e.g., acquirePositronApi throws), return undefined
        // This ensures extensions gracefully degrade to VS Code mode
        return undefined;
    }
}
