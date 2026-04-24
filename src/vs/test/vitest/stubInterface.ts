/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Builds a typed partial stub of interface or class `T` for tests, backed by a
 * `Proxy` that throws on any property access the stub did not explicitly set.
 *
 * Use this instead of `{ ... } as unknown as T` or other cast-based partial
 * stubs:
 *
 * - The `overrides` argument is typed as `Partial<T>`, so overrides stay
 *   structurally checked against the real interface. If a field is renamed
 *   upstream the override surfaces as a type error.
 * - Unset property reads throw with a clear message instead of silently
 *   returning `undefined`. That catches the failure mode where the code
 *   under test grows a new dependency, reads an unset field off the stub,
 *   and produces a misleading test failure rooted elsewhere.
 *
 * When a purpose-built test double already exists for the service, prefer
 * that over `stubInterface`. Examples:
 * - `NullLogService` from `platform/log/common/log.js` for `ILogService`.
 * - `TestConfigurationService` from
 *   `platform/configuration/test/common/testConfigurationService.js`.
 * - Various `Test*` classes under `workbench/test/**`.
 *
 * @example
 * ```ts
 * const logService = stubInterface<ILogService>({
 *     error: vi.fn(),
 * });
 * // Calling logService.error(...) works.
 * // Reading logService.info throws: unset property 'info'.
 * ```
 *
 * @example
 * ```ts
 * // Nested stubs are straightforward.
 * const instance = stubInterface<IPositronNotebookInstance>({
 *     hoverManager: undefined,
 *     selectionStateMachine: stubInterface<IPositronNotebookInstance['selectionStateMachine']>({
 *         selectCell: vi.fn(),
 *     }),
 * });
 * ```
 */
export function stubInterface<T extends object>(overrides: Partial<T> = {}): T {
	return new Proxy(overrides, {
		get(target, key) {
			// eslint-disable-next-line local/code-no-in-operator -- Proxy trap: `in` is the right primitive for "was this key set on overrides?"
			if (key in target) {
				return (target as Record<PropertyKey, unknown>)[key];
			}
			// Symbol access (Symbol.toStringTag, Symbol.iterator, etc.) is used by
			// runtime internals (console.log, await, for...of). Return undefined
			// so the stub composes cleanly with those paths.
			if (typeof key === 'symbol') {
				return undefined;
			}
			// Promise detection (await-unwrapping) probes for a `.then` property;
			// the stub should not look thenable unless explicitly configured to.
			if (key === 'then') {
				return undefined;
			}
			throw new Error(
				`stubInterface: test read property '${key}' but the stub did not set it. ` +
				`Add it to the overrides object or use a purpose-built test double.`
			);
		},
		has(target, key) {
			// eslint-disable-next-line local/code-no-in-operator -- Proxy trap: `in` is the defining primitive for the `has` handler
			return key in target;
		},
	}) as T;
}
