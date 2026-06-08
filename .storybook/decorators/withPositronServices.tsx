/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React from 'react';
import type { Decorator } from '@storybook/react';
import { Event } from '../../src/vs/base/common/event.js';
import { PositronReactServicesContext } from '../../src/vs/base/browser/positronReactRendererContext.js';
import { PositronActionBarContextProvider } from '../../src/vs/platform/positronActionBar/browser/positronActionBarContext.js';
import type { PositronReactServices } from '../../src/vs/base/browser/positronReactServices.js';

/**
 * Minimal services mock providing what PositronActionBarContextProvider needs.
 * Add stubs here as components demand more services.
 */
const services = {
	configurationService: {
		getValue: () => 300,
		onDidChangeConfiguration: Event.None,
	},
	hoverService: {
		showHover: () => undefined,
	},
	contextKeyService: {
		contextMatchesRules: () => false,
		onDidChangeContext: Event.None,
	},
	commandService: {
		executeCommand: () => Promise.resolve(),
	},
	accessibilityService: {
		isScreenReaderOptimized: () => false,
		onDidChangeScreenReaderOptimized: Event.None,
	},
} as unknown as PositronReactServices;

/**
 * Storybook decorator that provides the Positron React services context.
 * Use for components that call `usePositronReactServicesContext()`.
 *
 * Usage in a stories file:
 * ```tsx
 * export default {
 *     title: 'Notebook/MyComponent',
 *     component: MyComponent,
 *     decorators: [withPositronServices],
 * };
 * ```
 */
export const withPositronServices: Decorator = (Story) => (
	<PositronReactServicesContext.Provider value={services}>
		<PositronActionBarContextProvider>
			<Story />
		</PositronActionBarContextProvider>
	</PositronReactServicesContext.Provider>
);
