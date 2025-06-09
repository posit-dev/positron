/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Re-export the runtime function and types from the runtime module
export { tryAcquirePositronApi, inPositron, type PositronApi } from './runtime';

// Re-export preview functions
export { previewUrl } from './preview';

// Re-export all types from the positron namespace for type-only imports
export type * from 'positron';

// Global type declarations for Positron-injected functions
declare global {
	/**
	 * Global function that may be injected by Positron to acquire the Positron API.
	 * 
	 * **Important**: This function is `undefined` when running in VS Code and only exists
	 * when running in Positron. Always check for its existence before calling it.
	 * 
	 * For safer access to the Positron API, consider using `tryAcquirePositronApi()` instead,
	 * which handles the runtime detection automatically.
	 * 
	 * @returns The Positron API object, or undefined if not available
	 *
	 * @example
	 * ```typescript
	 * // Safe usage with type checking (recommended)
	 * if (typeof acquirePositronApi !== 'undefined') {
	 *   const positronApi = acquirePositronApi();
	 *   if (positronApi) {
	 *     // Use positronApi...
	 *     positronApi.runtime.executeCode('python', 'print("Hello!")', true);
	 *   }
	 * }
	 *
	 * // Alternative safe usage with optional chaining
	 * const positronApi = globalThis.acquirePositronApi?.();
	 * if (positronApi) {
	 *   // Use positronApi...
	 * }
	 * 
	 * // For simpler code, consider using the wrapper function:
	 * import { tryAcquirePositronApi } from '@posit-dev/positron';
	 * const positronApi = tryAcquirePositronApi();
	 * ```
	 */
	const acquirePositronApi: (() => typeof import('positron') | undefined) | undefined;
}
