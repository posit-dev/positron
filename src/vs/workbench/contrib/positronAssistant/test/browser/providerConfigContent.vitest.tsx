/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

// SPIKE (#14695): demonstrates that the chrome-agnostic content component tests the same way
// regardless of whether it is hosted by the modal renderer or the editor renderer -- the
// testability point behind the recommendation to keep the content decoupled from its host.

import { screen } from '@testing-library/react';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { ProviderConfigContent, ProviderSummary } from '../../browser/providerEditorSpike/providerConfigContent.js';

describe('ProviderConfigContent (spike #14695)', () => {
	const ctx = createTestContainer().withReactServices().build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	const providers: ProviderSummary[] = [
		{ id: 'anthropic-api', displayName: 'Anthropic', connected: true },
		{ id: 'openai-api', displayName: 'OpenAI', connected: false },
	];

	it('lists each provider with its connection status', () => {
		rtl.render(<ProviderConfigContent providers={providers} />);

		expect(screen.getByText('Anthropic')).toBeInTheDocument();
		expect(screen.getByText('OpenAI')).toBeInTheDocument();
		expect(screen.getByText('Connected')).toBeInTheDocument();
		expect(screen.getByText('Not connected')).toBeInTheDocument();
	});

	it('shows an empty message when no providers are enabled', () => {
		rtl.render(<ProviderConfigContent providers={[]} />);

		expect(screen.getByText(/No providers are currently enabled\./)).toBeInTheDocument();
	});
});
