/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { IPositronLanguageModelSource, LanguageModelAutoconfigureType, PositronLanguageModelType } from '../../common/interfaces/positronAssistantService.js';
import { ConnectedProviderView } from '../../browser/components/connectedProviderView.js';

const positAi: IPositronLanguageModelSource = {
	type: PositronLanguageModelType.Chat,
	provider: { id: 'posit-ai', displayName: 'Posit AI', settingName: 'posit-ai' },
	supportedOptions: ['oauth'],
	signedIn: true,
	defaults: {},
};

describe('ConnectedProviderView', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	it('shows how the provider is connected and reports a Sign Out footer action', () => {
		rtl.render(<ConnectedProviderView source={positAi} onAction={async () => { }} onBack={vi.fn()} onClose={vi.fn()} />);
		expect(screen.getByText(/connected via oauth/i)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Sign Out' })).toBeInTheDocument();
	});

	it('dispatches oauth-signout when the footer action runs', async () => {
		const onAction = vi.fn().mockResolvedValue(undefined);
		const user = userEvent.setup();
		rtl.render(<ConnectedProviderView source={positAi} onAction={onAction} onBack={vi.fn()} onClose={vi.fn()} />);
		await user.click(screen.getByRole('button', { name: 'Sign Out' }));
		expect(onAction).toHaveBeenCalledWith(positAi, expect.anything(), 'oauth-signout');
	});

	it('displays the current base URL for a provider that supports it', () => {
		const anthropic: IPositronLanguageModelSource = {
			type: PositronLanguageModelType.Chat,
			provider: { id: 'anthropic-api', displayName: 'Anthropic', settingName: 'anthropic' },
			supportedOptions: ['apiKey', 'baseUrl'],
			signedIn: true,
			defaults: { baseUrl: 'https://proxy.example/v1' },
		};
		rtl.render(<ConnectedProviderView source={anthropic} onAction={async () => { }} onBack={vi.fn()} onClose={vi.fn()} />);
		expect(screen.getByText('https://proxy.example/v1')).toBeInTheDocument();
	});

	it('omits the base URL row when the provider does not support it', () => {
		rtl.render(<ConnectedProviderView source={positAi} onAction={async () => { }} onBack={vi.fn()} onClose={vi.fn()} />);
		expect(screen.queryByText(/base url/i)).not.toBeInTheDocument();
	});

	it('shows an error banner (and not the connected line) when the provider status is error', () => {
		const broken: IPositronLanguageModelSource = {
			type: PositronLanguageModelType.Chat,
			provider: { id: 'anthropic-api', displayName: 'Anthropic', settingName: 'anthropic' },
			supportedOptions: ['apiKey', 'baseUrl'],
			signedIn: true,
			status: 'error',
			statusMessage: 'Bad base URL',
			defaults: {},
		};
		rtl.render(<ConnectedProviderView source={broken} onAction={async () => { }} onBack={vi.fn()} onClose={vi.fn()} />);
		expect(screen.getByText('Bad base URL')).toBeInTheDocument();
		expect(screen.queryByText(/connected to anthropic/i)).not.toBeInTheDocument();
	});

	it('shows the environment variable and no Disconnect footer button for env-authenticated providers', () => {
		const envAnthropic: IPositronLanguageModelSource = {
			type: PositronLanguageModelType.Chat,
			provider: { id: 'anthropic-api', displayName: 'Anthropic', settingName: 'anthropic' },
			supportedOptions: ['apiKey', 'baseUrl', 'autoconfigure'],
			signedIn: true,
			defaults: {
				autoconfigure: { type: LanguageModelAutoconfigureType.EnvVariable, key: 'ANTHROPIC_API_KEY', signedIn: true },
			},
		};
		rtl.render(<ConnectedProviderView source={envAnthropic} onAction={async () => { }} onBack={vi.fn()} onClose={vi.fn()} />);
		expect(screen.getByText(/connected via ANTHROPIC_API_KEY/i)).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
	});

	it('shows Accounts-menu sign-out guidance and no Disconnect for GitHub Copilot', () => {
		const copilot: IPositronLanguageModelSource = {
			type: PositronLanguageModelType.Chat,
			provider: { id: 'copilot-auth', displayName: 'GitHub Copilot', settingName: 'githubCopilot' },
			supportedOptions: ['oauth', 'autoconfigure'],
			signedIn: true,
			defaults: {
				autoconfigure: { type: LanguageModelAutoconfigureType.Custom, message: 'the Accounts menu.', signedIn: true },
			},
		};
		rtl.render(<ConnectedProviderView source={copilot} onAction={async () => { }} onBack={vi.fn()} onClose={vi.fn()} />);
		expect(screen.getByRole('link', { name: /manage accounts/i })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Sign Out' })).not.toBeInTheDocument();
	});

	it('shows a spinner and "Signing Out..." on the button while signing out', async () => {
		let resolveSignOut = () => { };
		const onAction = vi.fn().mockImplementation(() => new Promise<void>(resolve => { resolveSignOut = resolve; }));
		const user = userEvent.setup();
		rtl.render(<ConnectedProviderView source={positAi} onAction={onAction} onBack={vi.fn()} onClose={vi.fn()} />);
		await user.click(screen.getByRole('button', { name: 'Sign Out' }));
		const signingOut = screen.getByRole('button', { name: 'Signing Out...' });
		expect(signingOut).toBeDisabled();
		// eslint-disable-next-line no-restricted-syntax -- decorative codicon spinner has no ARIA role
		expect(signingOut.querySelector('.codicon-modifier-spin')).toBeInTheDocument();
		await act(async () => { resolveSignOut(); });
	});

	it('shows "Removing..." while removing an API-key provider', async () => {
		const anthropic: IPositronLanguageModelSource = {
			type: PositronLanguageModelType.Chat,
			provider: { id: 'anthropic-api', displayName: 'Anthropic', settingName: 'anthropic' },
			supportedOptions: ['apiKey', 'baseUrl'],
			signedIn: true,
			defaults: {},
		};
		let resolveRemove = () => { };
		const onAction = vi.fn().mockImplementation(() => new Promise<void>(resolve => { resolveRemove = resolve; }));
		const user = userEvent.setup();
		rtl.render(<ConnectedProviderView source={anthropic} onAction={onAction} onBack={vi.fn()} onClose={vi.fn()} />);
		await user.click(screen.getByRole('button', { name: 'Remove' }));
		expect(screen.getByRole('button', { name: 'Removing...' })).toBeDisabled();
		await act(async () => { resolveRemove(); });
	});

	it('shows no separate progress bar while an action is in flight', async () => {
		let resolve = () => { };
		const onAction = vi.fn().mockImplementation(() => new Promise<void>(r => { resolve = r; }));
		const user = userEvent.setup();
		rtl.render(<ConnectedProviderView source={positAi} onAction={onAction} onBack={vi.fn()} onClose={vi.fn()} />);
		await user.click(screen.getByRole('button', { name: 'Sign Out' }));
		expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
		await act(async () => { resolve(); });
	});
});
