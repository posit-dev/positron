/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />


import React from 'react';
import { Emitter } from '../../base/common/event.js';
import { usePositronReactServicesContext } from '../../base/browser/positronReactRendererContext.js';
import { setupRTLRenderer } from './reactTestingLibrary.js';

/**
 * Minimal services needed for the provider tree (PositronActionBarContextProvider
 * reads configurationService, hoverService, contextKeyService, accessibilityService).
 */
function minimalServices(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		configurationService: {
			getValue: () => 300 as unknown,
			onDidChangeConfiguration: new Emitter().event,
		},
		hoverService: {
			showInstantHover: () => ({ dispose: () => { } }),
			showHover: () => ({ dispose: () => { } }),
			hideHover: () => { },
		},
		contextKeyService: {
			onDidChangeContext: new Emitter().event,
			contextMatchesRules: () => true,
		},
		accessibilityService: {},
		...overrides,
	};
}

/** Test component that reads from context. */
const ServiceLabel = () => {
	const services = usePositronReactServicesContext();
	return <span>{(services as any).testValue ?? 'no value'}</span>;
};

/** Test component that takes props. */
const PropLabel = ({ text }: { text: string }) => {
	return <span>{text}</span>;
};

describe('setupRTLRenderer', () => {
	describe('service-context pattern', () => {
		const rtl = setupRTLRenderer(minimalServices({ testValue: 'hello from context' }));

		it('provides services via context', () => {
			const { getByText } = rtl.render(<ServiceLabel />);
			expect(getByText('hello from context')).toBeTruthy();
		});
	});

	describe('prop-driven pattern', () => {
		const rtl = setupRTLRenderer();

		it('renders without services wrapper', () => {
			const { getByText } = rtl.render(<PropLabel text="hello from props" />);
			expect(getByText('hello from props')).toBeTruthy();
		});
	});
});
