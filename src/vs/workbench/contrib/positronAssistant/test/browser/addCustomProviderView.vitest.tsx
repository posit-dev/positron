/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { IPositronLanguageModelSource, PositronLanguageModelType } from '../../common/interfaces/positronAssistantService.js';
import { AddCustomProviderView } from '../../browser/components/addCustomProviderView.js';
import { dialogProps } from './providerModalTestUtils.js';

function source(id: string, displayName: string, overrides: Partial<IPositronLanguageModelSource> = {}): IPositronLanguageModelSource {
	return {
		type: PositronLanguageModelType.Chat,
		provider: { id, displayName },
		supportedOptions: ['apiKey', 'baseUrl'],
		defaults: {},
		...overrides,
	};
}

// The built-ins the three offered kinds borrow their forms from, plus one
// existing custom entry to collide a name with.
const sources: IPositronLanguageModelSource[] = [
	source('openai-compatible', 'OpenAI Compatible', { defaults: { baseUrl: 'https://localhost:1337/v1' } }),
	source('anthropic-api', 'Anthropic', { defaults: { baseUrl: 'https://api.anthropic.com/v1' } }),
	source('openai-api', 'OpenAI', { defaults: { baseUrl: 'https://api.openai.com/v1' } }),
	source('My Gateway', 'My Gateway'),
];

describe('AddCustomProviderView', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	function renderView(onCreate = vi.fn().mockResolvedValue(undefined), onBack = vi.fn()) {
		rtl.render(
			<AddCustomProviderView
				{...dialogProps()}
				sources={sources}
				onBack={onBack}
				onCreate={onCreate}
			/>
		);
		return { onCreate, onBack };
	}

	it('borrows the default kind\'s fields, and prefills neither of them', () => {
		renderView();
		expect(screen.getByLabelText(/api key/i)).toHaveValue('');
		// The saved URL of the built-in it borrows from is not offered back.
		expect(screen.getByLabelText(/base url/i)).toHaveValue('');
	});

	it('creates the entry from the name, key, URL, and declared model ids', async () => {
		const user = userEvent.setup();
		const { onCreate, onBack } = renderView();
		await user.type(screen.getByLabelText('Provider Name'), 'Work Gateway');
		await user.type(screen.getByLabelText(/api key/i), 'sk-test');
		await user.type(screen.getByLabelText(/base url/i), 'https://gateway.example.com/v1');
		await user.click(screen.getByRole('button', { name: /models/i }));
		await user.type(screen.getByPlaceholderText('Model ID'), 'llama-3.3-70b');
		await user.click(screen.getByRole('button', { name: 'Add Provider' }));
		expect(onCreate).toHaveBeenCalledWith({
			name: 'Work Gateway',
			kind: 'openai-compatible',
			baseUrl: 'https://gateway.example.com/v1',
			apiKey: 'sk-test',
			modelIds: ['llama-3.3-70b'],
		});
		expect(onBack).toHaveBeenCalled();
	});

	it('refuses a blank name on submit rather than greying the button out', async () => {
		const user = userEvent.setup();
		const { onCreate } = renderView();
		await user.click(screen.getByRole('button', { name: 'Add Provider' }));
		expect(await screen.findByText('Enter a name for this provider.')).toBeInTheDocument();
		expect(onCreate).not.toHaveBeenCalled();
	});

	it('refuses a name an existing provider already has', async () => {
		const user = userEvent.setup();
		const { onCreate } = renderView();
		await user.type(screen.getByLabelText('Provider Name'), 'my gateway');
		await user.click(screen.getByRole('button', { name: 'Add Provider' }));
		expect(await screen.findByText(/already a provider named/i)).toBeInTheDocument();
		expect(onCreate).not.toHaveBeenCalled();
	});

	it('reports the writer\'s refusal in the form', async () => {
		const user = userEvent.setup();
		renderView(vi.fn().mockRejectedValue(new Error('An API key is required for an anthropic provider')));
		await user.type(screen.getByLabelText('Provider Name'), 'Gateway Two');
		await user.click(screen.getByRole('button', { name: 'Add Provider' }));
		expect(await screen.findByText('An API key is required for an anthropic provider')).toBeInTheDocument();
	});

	it('keeps the model rows collapsed until they are asked for', async () => {
		const user = userEvent.setup();
		renderView();
		expect(screen.queryByPlaceholderText('Model ID')).not.toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: /models/i }));
		expect(screen.getByPlaceholderText('Model ID')).toBeInTheDocument();
	});

	it('changing the type keeps everything already typed', async () => {
		const user = userEvent.setup();
		renderView();
		await user.type(screen.getByLabelText('Provider Name'), 'Work Anthropic');
		await user.type(screen.getByLabelText(/api key/i), 'sk-for-the-gateway');
		await user.type(screen.getByLabelText(/base url/i), 'https://gateway.example.com/v1');
		await user.click(screen.getByRole('button', { name: /models/i }));
		await user.type(screen.getByPlaceholderText('Model ID'), 'claude-opus-4');
		await user.click(screen.getByRole('button', { name: 'OpenAI Compatible' }));
		await user.click(screen.getByRole('button', { name: 'Anthropic' }));
		expect(screen.getByLabelText('Provider Name')).toHaveValue('Work Anthropic');
		expect(screen.getByLabelText(/api key/i)).toHaveValue('sk-for-the-gateway');
		expect(screen.getByLabelText(/base url/i)).toHaveValue('https://gateway.example.com/v1');
		expect(screen.getByPlaceholderText('Model ID')).toHaveValue('claude-opus-4');
	});
});
