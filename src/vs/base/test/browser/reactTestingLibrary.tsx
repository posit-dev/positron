/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import React, { type ReactElement } from 'react';
import { render, cleanup, type RenderResult } from '@testing-library/react';
import { PositronReactServicesContext } from '../../browser/positronReactRendererContext.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TestServices = Record<string, any>;

/**
 * Sets up an RTL renderer that wraps components in PositronReactServicesContext.
 *
 * Bridges `createTestContainer()` with `@testing-library/react`: pass the
 * services your component needs as a partial object, and the helper wraps
 * every `render()` call in the context provider.
 *
 * Registers an `afterEach` hook that calls RTL `cleanup()` so React trees
 * are unmounted between tests (required for disposable leak detection).
 *
 * ## Patterns
 *
 * **Service-context pattern** (components that call `usePositronReactServicesContext`):
 * ```tsx
 * const ctx = createTestContainer().withRuntimeServices().build();
 * const rtl = setupRTLRenderer({
 *     runtimeSessionService: ctx.get(IRuntimeSessionService),
 * });
 *
 * it('renders session label', () => {
 *     // getByText throws if not found -- the call itself is the assertion.
 *     rtl.render(<MyComponent />).getByText('Start Session');
 * });
 * ```
 *
 * **Prop-driven pattern** (components that receive data via props):
 * ```tsx
 * const rtl = setupRTLRenderer();
 *
 * it('renders prop value', () => {
 *     rtl.render(<Label text="hello" />).getByText('hello');
 * });
 * ```
 *
 * @param services Partial services object. Merged into the context provider
 *   value. Components access these via `usePositronReactServicesContext()`.
 *   Omit for prop-driven components that don't use the context.
 */
export function setupRTLRenderer(services?: TestServices) {
	afterEach(() => {
		cleanup();
	});

	return {
		/**
		 * Render a React element wrapped in PositronReactServicesContext.
		 * Returns the full RTL RenderResult (getByText, getByRole, etc.).
		 */
		render(element: ReactElement): RenderResult {
			const wrapper = services
				? ({ children }: { children: React.ReactNode }) => (
					<PositronReactServicesContext.Provider value={services as any}>
						{children}
					</PositronReactServicesContext.Provider>
				)
				: undefined;

			return render(element, { wrapper });
		},
	};
}
