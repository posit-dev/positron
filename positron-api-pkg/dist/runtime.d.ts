import type * as positron from 'positron';
export type PositronApi = typeof positron;
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
export declare function tryAcquirePositronApi(): PositronApi | undefined;
