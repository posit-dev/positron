/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { IPositronLanguageModelSource, PositronLanguageModelType } from '../../common/interfaces/positronAssistantService.js';
import { ConnectProviderView } from '../../browser/components/connectProviderView.js';

const positAi: IPositronLanguageModelSource = {
	type: PositronLanguageModelType.Chat,
	provider: { id: 'posit-ai', displayName: 'Posit AI', settingName: 'posit-ai' },
	supportedOptions: ['oauth'],
	signedIn: false,
	defaults: {},
};

const anthropic: IPositronLanguageModelSource = {
	type: PositronLanguageModelType.Chat,
	provider: { id: 'anthropic-api', displayName: 'Anthropic', settingName: 'anthropic' },
	supportedOptions: ['apiKey', 'baseUrl'],
	signedIn: false,
	defaults: { baseUrl: 'https://api.anthropic.com' },
};

const lmstudio: IPositronLanguageModelSource = {
	type: PositronLanguageModelType.Chat,
	provider: { id: 'lmstudio', displayName: 'LM Studio', settingName: 'lmStudio' },
	supportedOptions: ['baseUrl'],
	signedIn: false,
	defaults: { baseUrl: 'http://localhost:1234/v1' },
};

describe('ConnectProviderView', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	it('renders a Connect footer button and legal text for Posit AI', () => {
		rtl.render(<ConnectProviderView source={positAi} onAction={async () => { }} onBack={vi.fn()} onClose={vi.fn()} />);
		expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled();
		expect(screen.getByTestId('provider-notice')).toBeInTheDocument();
	});

	it('dispatches oauth-signin when Connect is clicked', async () => {
		const onAction = vi.fn().mockResolvedValue(undefined);
		const user = userEvent.setup();
		rtl.render(<ConnectProviderView source={positAi} onAction={onAction} onBack={vi.fn()} onClose={vi.fn()} />);
		await user.click(screen.getByRole('button', { name: 'Connect' }));
		expect(onAction).toHaveBeenCalledWith(positAi, expect.anything(), 'oauth-signin');
	});

	it('invokes onBack and onClose from the footer buttons', async () => {
		const onBack = vi.fn();
		const onClose = vi.fn();
		const user = userEvent.setup();
		rtl.render(<ConnectProviderView source={positAi} onAction={async () => { }} onBack={onBack} onClose={onClose} />);
		await user.click(screen.getByRole('button', { name: 'Back' }));
		await user.click(screen.getByRole('button', { name: 'Close' }));
		expect(onBack).toHaveBeenCalled();
		expect(onClose).toHaveBeenCalled();
	});

	it('reports a cancel handler while an OAuth sign-in is in progress that dispatches cancel', async () => {
		let resolveSignIn = () => { };
		const onAction = vi.fn().mockImplementation((_source, _config, action) =>
			action === 'oauth-signin' ? new Promise<void>(resolve => { resolveSignIn = resolve; }) : Promise.resolve());
		let reportedCancel: (() => void) | undefined;
		const user = userEvent.setup();
		rtl.render(<ConnectProviderView source={positAi} onAction={onAction} onBack={vi.fn()} onClose={vi.fn()} onPendingSignInChange={cancel => { reportedCancel = cancel; }} />);
		expect(reportedCancel).toBeUndefined();
		await user.click(screen.getByRole('button', { name: 'Connect' }));
		expect(reportedCancel).toBeTypeOf('function');
		reportedCancel!();
		expect(onAction).toHaveBeenCalledWith(positAi, expect.anything(), 'cancel');
		await act(async () => { resolveSignIn(); });
	});

	it('shows a failed sign-in in the error banner', async () => {
		const onAction = vi.fn().mockRejectedValue(new Error('Bad key'));
		const user = userEvent.setup();
		rtl.render(<ConnectProviderView source={positAi} onAction={onAction} onBack={vi.fn()} onClose={vi.fn()} />);
		await user.click(screen.getByRole('button', { name: 'Connect' }));
		expect(await screen.findByText('Bad key')).toBeInTheDocument();
	});

	it('renders an API key input for an API-key provider', () => {
		rtl.render(<ConnectProviderView source={anthropic} onAction={async () => { }} onBack={vi.fn()} onClose={vi.fn()} />);
		expect(screen.getByLabelText(/api key/i)).toBeInTheDocument();
	});

	it('disables Connect until an API key is entered', async () => {
		const user = userEvent.setup();
		rtl.render(<ConnectProviderView source={anthropic} onAction={async () => { }} onBack={vi.fn()} onClose={vi.fn()} />);
		expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
		await user.type(screen.getByLabelText(/api key/i), 'sk-test');
		expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled();
	});

	it('collects an API key and dispatches save when Connect is clicked', async () => {
		const onAction = vi.fn().mockResolvedValue(undefined);
		const user = userEvent.setup();
		rtl.render(<ConnectProviderView source={anthropic} onAction={onAction} onBack={vi.fn()} onClose={vi.fn()} />);
		await user.type(screen.getByLabelText(/api key/i), 'sk-test');
		await user.click(screen.getByRole('button', { name: 'Connect' }));
		expect(onAction).toHaveBeenCalledWith(anthropic, expect.objectContaining({ apiKey: 'sk-test' }), 'save');
	});

	it('renders a base URL input prefilled with the current value', () => {
		rtl.render(<ConnectProviderView source={anthropic} onAction={async () => { }} onBack={vi.fn()} onClose={vi.fn()} />);
		expect(screen.getByLabelText(/base url/i)).toHaveValue('https://api.anthropic.com');
	});

	it('includes an edited base URL in the dispatched config', async () => {
		const onAction = vi.fn().mockResolvedValue(undefined);
		const user = userEvent.setup();
		rtl.render(<ConnectProviderView source={anthropic} onAction={onAction} onBack={vi.fn()} onClose={vi.fn()} />);
		await user.type(screen.getByLabelText(/api key/i), 'sk-test');
		const baseUrlInput = screen.getByLabelText(/base url/i);
		await user.clear(baseUrlInput);
		await user.type(baseUrlInput, 'https://proxy.example/v1');
		await user.click(screen.getByRole('button', { name: 'Connect' }));
		expect(onAction).toHaveBeenCalledWith(
			anthropic,
			expect.objectContaining({ apiKey: 'sk-test', baseUrl: 'https://proxy.example/v1' }),
			'save',
		);
	});

	it('shows the base URL input and no API key for a base-URL-only provider', () => {
		rtl.render(<ConnectProviderView source={lmstudio} onAction={async () => { }} onBack={vi.fn()} onClose={vi.fn()} />);
		expect(screen.getByLabelText(/base url/i)).toHaveValue('http://localhost:1234/v1');
		expect(screen.queryByLabelText(/api key/i)).not.toBeInTheDocument();
	});

	it('dispatches save with the base URL for a base-URL-only provider', async () => {
		const onAction = vi.fn().mockResolvedValue(undefined);
		const user = userEvent.setup();
		rtl.render(<ConnectProviderView source={lmstudio} onAction={onAction} onBack={vi.fn()} onClose={vi.fn()} />);
		const baseUrlInput = screen.getByLabelText(/base url/i);
		await user.clear(baseUrlInput);
		await user.type(baseUrlInput, 'http://localhost:4321/v1');
		await user.click(screen.getByRole('button', { name: 'Connect' }));
		expect(onAction).toHaveBeenCalledWith(lmstudio, expect.objectContaining({ baseUrl: 'http://localhost:4321/v1' }), 'save');
	});

	it('shows a spinner and "Connecting..." on the primary button while the sign-in is in flight', async () => {
		let resolveSignIn = () => { };
		const onAction = vi.fn().mockImplementation(() => new Promise<void>(resolve => { resolveSignIn = resolve; }));
		const user = userEvent.setup();
		rtl.render(<ConnectProviderView source={positAi} onAction={onAction} onBack={vi.fn()} onClose={vi.fn()} />);
		await user.click(screen.getByRole('button', { name: 'Connect' }));
		const connecting = screen.getByRole('button', { name: 'Connecting...' });
		expect(connecting).toBeDisabled();
		// eslint-disable-next-line no-restricted-syntax -- decorative codicon spinner has no ARIA role
		expect(connecting.querySelector('.codicon-modifier-spin')).toBeInTheDocument();
		await act(async () => { resolveSignIn(); });
		expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
	});

	it('spins only the Remove button (not Connect) while an error-state remove is in flight', async () => {
		const erroredAnthropic = { ...anthropic, status: 'error' as const, signedIn: false };
		let resolveRemove = () => { };
		const onAction = vi.fn().mockImplementation(() => new Promise<void>(resolve => { resolveRemove = resolve; }));
		const user = userEvent.setup();
		rtl.render(<ConnectProviderView source={erroredAnthropic} onAction={onAction} onBack={vi.fn()} onClose={vi.fn()} />);
		await user.click(screen.getByRole('button', { name: 'Remove' }));
		expect(screen.getByRole('button', { name: 'Removing...' })).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
		await act(async () => { resolveRemove(); });
	});

	it('keeps Connect disabled while removing an errored, signed-in OAuth provider', async () => {
		const erroredPositAi = { ...positAi, signedIn: true, status: 'error' as const };
		let resolveRemove = () => { };
		const onAction = vi.fn().mockImplementation(() => new Promise<void>(resolve => { resolveRemove = resolve; }));
		const user = userEvent.setup();
		rtl.render(<ConnectProviderView source={erroredPositAi} onAction={onAction} onBack={vi.fn()} onClose={vi.fn()} />);
		await user.click(screen.getByRole('button', { name: 'Remove' }));
		expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
		await act(async () => { resolveRemove(); });
	});

	it('shows no separate progress bar while an action is in flight', async () => {
		let resolve = () => { };
		const onAction = vi.fn().mockImplementation(() => new Promise<void>(r => { resolve = r; }));
		const user = userEvent.setup();
		rtl.render(<ConnectProviderView source={positAi} onAction={onAction} onBack={vi.fn()} onClose={vi.fn()} />);
		await user.click(screen.getByRole('button', { name: 'Connect' }));
		expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
		await act(async () => { resolve(); });
	});
});
