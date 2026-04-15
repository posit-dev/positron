/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import React, { type ReactElement } from 'react';
import { render, cleanup, type RenderResult } from '@testing-library/react';
import { PositronReactServicesContext } from '../../browser/positronReactRendererContext.js';
import { PositronActionBarContextProvider } from '../../../platform/positronActionBar/browser/positronActionBarContext.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TestServices = Record<string, any>;

/**
 * Sets up an RTL renderer that wraps components in the standard Positron
 * provider tree: PositronReactServicesContext + PositronActionBarContext.
 *
 * Bridges `createTestContainer()` with `@testing-library/react`. The
 * wrapper tree is set up once; every `render()` call automatically gets
 * the full provider stack. No manual provider wrapping needed in tests.
 *
 * Registers an `afterEach` hook that calls RTL `cleanup()` so React trees
 * are unmounted between tests (required for disposable leak detection).
 *
 * ## Patterns
 *
 * **Builder + React bridge** (recommended for components using `usePositronReactServicesContext`):
 * ```tsx
 * const ctx = createTestContainer().withReactServices().build();
 * const rtl = setupRTLRenderer(() => ctx.reactServices);
 *
 * it('renders session label', () => {
 *     rtl.render(<MyComponent />).getByText('Start Session');
 * });
 * ```
 *
 * **Prop-driven pattern** (components that receive all data via props):
 * ```tsx
 * const rtl = setupRTLRenderer();
 *
 * it('renders prop value', () => {
 *     rtl.render(<Label text="hello" />).getByText('hello');
 * });
 * ```
 *
 * @param services Services for the React context. Accepts either:
 *   - A plain object (static services, resolved immediately)
 *   - A function returning services (deferred, resolved at render time --
 *     required when using `ctx.reactServices` from the builder since services
 *     are created fresh in each `beforeEach`)
 *   Omit for prop-driven components that don't use the context.
 */
export function setupRTLRenderer(services?: TestServices | (() => TestServices)) {
	afterEach(() => {
		cleanup();
	});

	return {
		/**
		 * Render a React element wrapped in the full Positron provider tree.
		 * Returns the full RTL RenderResult (getByText, getByRole, etc.).
		 */
		render(element: ReactElement): RenderResult {
			const resolvedServices = typeof services === 'function' ? services() : services;
			const wrapper = resolvedServices
				? ({ children }: { children: React.ReactNode }) => (
					<PositronReactServicesContext.Provider value={resolvedServices as any}>
						<PositronActionBarContextProvider>
							{children}
						</PositronActionBarContextProvider>
					</PositronReactServicesContext.Provider>
				)
				: undefined;

			return render(element, { wrapper });
		},
	};
}
