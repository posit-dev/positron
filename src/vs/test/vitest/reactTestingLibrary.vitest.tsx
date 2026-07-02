/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter } from '../../base/common/event.js';
import { usePositronReactServicesContext } from '../../base/browser/positronReactRendererContext.js';
import { setupRTLRenderer } from './reactTestingLibrary.js';
import { screen } from '@testing-library/dom';

// Shared emitters for minimalServices(). Declared at module scope and
// disposed in afterAll so we don't leak emitters per test or per describe
// block.
const configChangeEmitter = new Emitter<unknown>();
const contextChangeEmitter = new Emitter<unknown>();

afterAll(() => {
	configChangeEmitter.dispose();
	contextChangeEmitter.dispose();
});

/**
 * Minimal services needed for the provider tree (PositronActionBarContextProvider
 * reads configurationService, hoverService, contextKeyService, accessibilityService).
 */
function minimalServices(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		configurationService: {
			getValue: () => 300 as unknown,
			onDidChangeConfiguration: configChangeEmitter.event,
		},
		hoverService: {
			showInstantHover: () => ({ dispose: () => { } }),
			showHover: () => ({ dispose: () => { } }),
			hideHover: () => { },
		},
		contextKeyService: {
			onDidChangeContext: contextChangeEmitter.event,
			contextMatchesRules: () => true,
		},
		accessibilityService: {},
		...overrides,
	};
}

/** Test component that reads from context. */
const ServiceLabel = () => {
	const services = usePositronReactServicesContext() as { testValue?: string };
	return <span>{services.testValue ?? 'no value'}</span>;
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
			// showcase for destructure pattern -- this file demonstrates both idioms
			// eslint-disable-next-line testing-library/prefer-screen-queries
			expect(getByText('hello from context')).toBeInTheDocument();
		});
	});

	describe('prop-driven pattern', () => {
		const rtl = setupRTLRenderer();

		it('renders without services wrapper', () => {
			const { getByText } = rtl.render(<PropLabel text='hello from props' />);
			// showcase for destructure pattern -- this file demonstrates both idioms
			// eslint-disable-next-line testing-library/prefer-screen-queries
			expect(getByText('hello from props')).toBeInTheDocument();
		});
	});

	describe('custom container', () => {
		const rtl = setupRTLRenderer();

		it('renders into the provided container', () => {
			const container = document.createElement('div');
			document.body.appendChild(container);

			rtl.render(<PropLabel text='hello in container' />, { container });

			// The element is rendered inside the supplied container rather than
			// a default RTL-created container.
			const label = screen.getByText('hello in container');
			expect(label).toBeInTheDocument();
			expect(container).toContainElement(label);
		});
	});
});
