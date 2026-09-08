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
import { dialogProps } from './providerModalTestUtils.js';

const positAi: IPositronLanguageModelSource = {
	type: PositronLanguageModelType.Chat,
	provider: { id: 'posit-ai', displayName: 'Posit AI Pass' },
	supportedOptions: ['oauth'],
	signedIn: false,
	defaults: {},
};

const anthropic: IPositronLanguageModelSource = {
	type: PositronLanguageModelType.Chat,
	provider: { id: 'anthropic-api', displayName: 'Anthropic' },
	supportedOptions: ['apiKey', 'baseUrl'],
	signedIn: false,
	defaults: { baseUrl: 'https://api.anthropic.com' },
};

const lmstudio: IPositronLanguageModelSource = {
	type: PositronLanguageModelType.Chat,
	provider: { id: 'lmstudio', displayName: 'LM Studio' },
	supportedOptions: ['baseUrl'],
	signedIn: false,
	defaults: { baseUrl: 'http://localhost:1234/v1' },
};

const databricks: IPositronLanguageModelSource = {
	type: PositronLanguageModelType.Chat,
	provider: { id: 'databricks', displayName: 'Databricks' },
	supportedOptions: ['apiKey', 'baseUrl'],
	signedIn: false,
	defaults: { baseUrl: 'https://workspace.example.com' },
};

// Snowflake stores the bare account, not a URL, in baseUrl.
const snowflake: IPositronLanguageModelSource = {
	type: PositronLanguageModelType.Chat,
	provider: { id: 'snowflake-cortex', displayName: 'Snowflake' },
	supportedOptions: ['apiKey', 'baseUrl'],
	signedIn: false,
	defaults: { baseUrl: 'myorg-account1' },
};

const databricksOAuth: IPositronLanguageModelSource = {
	type: PositronLanguageModelType.Chat,
	provider: { id: 'databricks', displayName: 'Databricks' },
	supportedOptions: ['oauth', 'apiKey', 'baseUrl'],
	signedIn: false,
	defaults: { baseUrl: 'https://workspace.example.com' },
};


// Bedrock authenticates through the AWS credential chain -- no API key, no base
// URL -- so the only inputs are the optional profile and region.
const bedrock: IPositronLanguageModelSource = {
	type: PositronLanguageModelType.Chat,
	provider: { id: 'amazon-bedrock', displayName: 'Amazon Bedrock' },
	supportedOptions: ['toolCalls', 'aws'],
	signedIn: false,
	defaults: { aws: { profile: 'data-team', region: 'eu-west-1' } },
};

// AWS_REGION set in the extension host's environment, which outranks
// providers.json -- so the region box is not something this form can set.
const bedrockRegionFromEnv: IPositronLanguageModelSource = {
	...bedrock,
	overrides: { aws: { region: { value: 'us-east-2', name: 'AWS_REGION' } } },
};

const bedrockBothFromEnv: IPositronLanguageModelSource = {
	...bedrock,
	overrides: {
		aws: {
			profile: { value: 'ci-runner', name: 'AWS_PROFILE' },
			region: { value: 'us-east-2', name: 'AWS_REGION' },
		},
	},
};

const custom: IPositronLanguageModelSource = {
	type: PositronLanguageModelType.Chat,
	provider: { id: 'openai-compatible', displayName: 'OpenAI Compatible', settingName: 'openai-compatible' },
	supportedOptions: ['apiKey', 'baseUrl', 'toolCalls', 'protocol', 'customModels'],
	signedIn: false,
	defaults: { protocol: 'openai-chat' },
};

describe('ConnectProviderView', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	it('renders a Connect footer button and legal text for Posit AI Pass', () => {
		rtl.render(<ConnectProviderView {...dialogProps()} source={positAi} onAction={async () => { }} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
		expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled();
		expect(screen.getByTestId('provider-notice')).toBeInTheDocument();
	});

	it('dispatches oauth-signin when Connect is clicked', async () => {
		const onAction = vi.fn().mockResolvedValue(undefined);
		const user = userEvent.setup();
		rtl.render(<ConnectProviderView {...dialogProps()} source={positAi} onAction={onAction} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
		await user.click(screen.getByRole('button', { name: 'Connect' }));
		expect(onAction).toHaveBeenCalledWith(positAi, expect.anything(), 'oauth-signin');
	});

	it('invokes onBack from the footer, and leaves Close to the title bar', async () => {
		const onBack = vi.fn();
		const user = userEvent.setup();
		rtl.render(<ConnectProviderView {...dialogProps()} source={positAi} onAction={async () => { }} onBack={onBack} onEditRawConfig={vi.fn()} />);
		await user.click(screen.getByRole('button', { name: 'Back' }));
		expect(onBack).toHaveBeenCalled();
		expect(screen.getByRole('button', { name: 'Close' })).toHaveClass('title-bar-close-button');
	});

	it('connects when Enter is pressed in the API key field', async () => {
		const onAction = vi.fn().mockResolvedValue(undefined);
		const user = userEvent.setup();
		rtl.render(<ConnectProviderView {...dialogProps()} source={anthropic} onAction={onAction} onBack={vi.fn()} />);
		await user.type(screen.getByLabelText(/api key/i), 'sk-test{Enter}');
		expect(onAction).toHaveBeenCalledWith(anthropic, expect.objectContaining({ apiKey: 'sk-test' }), expect.anything());
	});

	it('cancels an in-flight OAuth sign-in when the view unmounts', async () => {
		let resolveSignIn = () => { };
		const onAction = vi.fn().mockImplementation((_source, _config, action) =>
			action === 'oauth-signin' ? new Promise<void>(resolve => { resolveSignIn = resolve; }) : Promise.resolve());
		const user = userEvent.setup();
		const { unmount } = rtl.render(<ConnectProviderView {...dialogProps()} source={positAi} onAction={onAction} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
		await user.click(screen.getByRole('button', { name: 'Connect' }));
		expect(onAction.mock.calls.map(([, , action]) => action)).toStrictEqual(['oauth-signin']);

		unmount();

		expect(onAction.mock.calls.map(([, , action]) => action)).toStrictEqual(['oauth-signin', 'cancel']);
		expect(onAction).toHaveBeenCalledWith(positAi, expect.anything(), 'cancel');
		await act(async () => { resolveSignIn(); });
	});

	it('leaves a finished OAuth sign-in alone when the view unmounts', async () => {
		const onAction = vi.fn().mockResolvedValue(undefined);
		const user = userEvent.setup();
		const { unmount } = rtl.render(<ConnectProviderView {...dialogProps()} source={positAi} onAction={onAction} onBack={vi.fn()} />);
		await user.click(screen.getByRole('button', { name: 'Connect' }));

		unmount();

		expect(onAction.mock.calls.map(([, , action]) => action)).toStrictEqual(['oauth-signin']);
	});

	it('shows a failed sign-in in the error banner', async () => {
		const onAction = vi.fn().mockRejectedValue(new Error('Bad key'));
		const user = userEvent.setup();
		rtl.render(<ConnectProviderView {...dialogProps()} source={positAi} onAction={onAction} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
		await user.click(screen.getByRole('button', { name: 'Connect' }));
		expect(await screen.findByText('Bad key')).toBeInTheDocument();
	});

	it('renders an API key input for an API-key provider', () => {
		rtl.render(<ConnectProviderView {...dialogProps()} source={anthropic} onAction={async () => { }} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
		expect(screen.getByLabelText(/api key/i)).toBeInTheDocument();
	});

	it('disables Connect until an API key is entered', async () => {
		const user = userEvent.setup();
		rtl.render(<ConnectProviderView {...dialogProps()} source={anthropic} onAction={async () => { }} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
		expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
		await user.type(screen.getByLabelText(/api key/i), 'sk-test');
		expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled();
	});

	it('collects an API key and dispatches save when Connect is clicked', async () => {
		const onAction = vi.fn().mockResolvedValue(undefined);
		const user = userEvent.setup();
		rtl.render(<ConnectProviderView {...dialogProps()} source={anthropic} onAction={onAction} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
		await user.type(screen.getByLabelText(/api key/i), 'sk-test');
		await user.click(screen.getByRole('button', { name: 'Connect' }));
		expect(onAction).toHaveBeenCalledWith(anthropic, expect.objectContaining({ apiKey: 'sk-test' }), 'save');
	});

	it('renders a base URL input prefilled with the current value', () => {
		rtl.render(<ConnectProviderView {...dialogProps()} source={anthropic} onAction={async () => { }} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
		expect(screen.getByLabelText(/base url/i)).toHaveValue('https://api.anthropic.com');
	});

	it('includes an edited base URL in the dispatched config', async () => {
		const onAction = vi.fn().mockResolvedValue(undefined);
		const user = userEvent.setup();
		rtl.render(<ConnectProviderView {...dialogProps()} source={anthropic} onAction={onAction} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
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
		rtl.render(<ConnectProviderView {...dialogProps()} source={lmstudio} onAction={async () => { }} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
		expect(screen.getByLabelText(/base url/i)).toHaveValue('http://localhost:1234/v1');
		expect(screen.queryByLabelText(/api key/i)).not.toBeInTheDocument();
	});

	it('labels the Databricks base URL input as the workspace URL', () => {
		rtl.render(<ConnectProviderView {...dialogProps()} source={databricks} onAction={async () => { }} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
		expect(screen.getByLabelText('Workspace URL')).toHaveValue('https://workspace.example.com');
		expect(screen.queryByLabelText('Base URL')).not.toBeInTheDocument();
	});

	it('labels the Snowflake base URL input as the account identifier', () => {
		rtl.render(<ConnectProviderView {...dialogProps()} source={snowflake} onAction={async () => { }} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
		expect(screen.getByLabelText('Account Identifier')).toHaveValue('myorg-account1');
		expect(screen.queryByLabelText('Base URL')).not.toBeInTheDocument();
	});

	it('dispatches save with the base URL for a base-URL-only provider', async () => {
		const onAction = vi.fn().mockResolvedValue(undefined);
		const user = userEvent.setup();
		rtl.render(<ConnectProviderView {...dialogProps()} source={lmstudio} onAction={onAction} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
		const baseUrlInput = screen.getByLabelText(/base url/i);
		await user.clear(baseUrlInput);
		await user.type(baseUrlInput, 'http://localhost:4321/v1');
		await user.click(screen.getByRole('button', { name: 'Connect' }));
		expect(onAction).toHaveBeenCalledWith(lmstudio, expect.objectContaining({ baseUrl: 'http://localhost:4321/v1' }), 'save');
	});

	it('does not render the API Type selector while it is deferred (#13817)', () => {
		rtl.render(<ConnectProviderView {...dialogProps()} source={custom} onAction={async () => { }} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
		expect(screen.queryByText('OpenAI Chat Completions')).not.toBeInTheDocument();
	});

	it('dispatches OpenAI Chat Completions as the API type', async () => {
		const onAction = vi.fn().mockResolvedValue(undefined);
		const user = userEvent.setup();
		rtl.render(<ConnectProviderView {...dialogProps()} source={custom} onAction={onAction} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
		await user.type(screen.getByLabelText(/api key/i), 'sk-test');
		await user.click(screen.getByRole('button', { name: 'Connect' }));
		expect(onAction).toHaveBeenCalledWith(custom, expect.objectContaining({ protocol: 'openai-chat' }), 'save');
	});

	it('builds schema-valid custom models from the entered ids, defaulting capabilities', async () => {
		const onAction = vi.fn().mockResolvedValue(undefined);
		const user = userEvent.setup();
		rtl.render(<ConnectProviderView {...dialogProps()} source={custom} onAction={onAction} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
		await user.type(screen.getByLabelText(/api key/i), 'sk-test');
		await user.type(screen.getByPlaceholderText('Model ID'), 'my-model-1');
		await user.click(screen.getByRole('button', { name: 'Add Model' }));
		const rows = screen.getAllByPlaceholderText('Model ID');
		await user.type(rows[1], 'my-model-2');
		await user.click(screen.getByRole('button', { name: 'Connect' }));
		expect(onAction).toHaveBeenCalledWith(
			custom,
			expect.objectContaining({
				customModels: [
					{ id: 'my-model-1', name: 'my-model-1', maxContextLength: 128000, supportsTools: true, supportsImages: false, supportsToolResultImages: false, supportsWebSearch: false },
					{ id: 'my-model-2', name: 'my-model-2', maxContextLength: 128000, supportsTools: true, supportsImages: false, supportsToolResultImages: false, supportsWebSearch: false },
				],
			}),
			'save',
		);
	});

	it('invokes onEditRawConfig from the edit-providers.json link', async () => {
		const onEditRawConfig = vi.fn();
		const user = userEvent.setup();
		rtl.render(<ConnectProviderView {...dialogProps()} source={custom} onAction={async () => { }} onBack={vi.fn()} onEditRawConfig={onEditRawConfig} />);
		await user.click(screen.getByRole('button', { name: /edit providers\.json/i }));
		expect(onEditRawConfig).toHaveBeenCalledOnce();
	});

	it('drops a removed model row from the dispatched config', async () => {
		const onAction = vi.fn().mockResolvedValue(undefined);
		const user = userEvent.setup();
		rtl.render(<ConnectProviderView {...dialogProps()} source={custom} onAction={onAction} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
		await user.type(screen.getByLabelText(/api key/i), 'sk-test');
		await user.type(screen.getByPlaceholderText('Model ID'), 'keep-me');
		await user.click(screen.getByRole('button', { name: 'Add Model' }));
		await user.type(screen.getAllByPlaceholderText('Model ID')[1], 'drop-me');
		await user.click(screen.getAllByRole('button', { name: 'Remove Model' })[1]);
		await user.click(screen.getByRole('button', { name: 'Connect' }));
		expect(onAction).toHaveBeenCalledWith(
			custom,
			expect.objectContaining({ customModels: [expect.objectContaining({ id: 'keep-me' })] }),
			'save',
		);
	});

	it('shows a spinner and "Connecting..." on the primary button while the sign-in is in flight', async () => {
		let resolveSignIn = () => { };
		const onAction = vi.fn().mockImplementation(() => new Promise<void>(resolve => { resolveSignIn = resolve; }));
		const user = userEvent.setup();
		rtl.render(<ConnectProviderView {...dialogProps()} source={positAi} onAction={onAction} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
		await user.click(screen.getByRole('button', { name: 'Connect' }));
		const connecting = screen.getByRole('button', { name: 'Connecting...' });
		expect(connecting).toBeDisabled();
		// eslint-disable-next-line no-restricted-syntax -- decorative codicon spinner has no ARIA role
		expect(connecting.querySelector('.codicon-modifier-spin')).toBeInTheDocument();
		await act(async () => { resolveSignIn(); });
		expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
	});

	it('spins only the Disconnect button (not Connect) while an error-state disconnect is in flight', async () => {
		const erroredAnthropic = { ...anthropic, status: 'error' as const, signedIn: false };
		let resolveDisconnect = () => { };
		const onAction = vi.fn().mockImplementation(() => new Promise<void>(resolve => { resolveDisconnect = resolve; }));
		const user = userEvent.setup();
		rtl.render(<ConnectProviderView {...dialogProps()} source={erroredAnthropic} onAction={onAction} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
		await user.click(screen.getByRole('button', { name: 'Disconnect' }));
		expect(screen.getByRole('button', { name: 'Disconnecting...' })).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
		await act(async () => { resolveDisconnect(); });
	});

	it('keeps Connect disabled while disconnecting an errored, signed-in OAuth provider', async () => {
		const erroredPositAi = { ...positAi, signedIn: true, status: 'error' as const };
		let resolveDisconnect = () => { };
		const onAction = vi.fn().mockImplementation(() => new Promise<void>(resolve => { resolveDisconnect = resolve; }));
		const user = userEvent.setup();
		rtl.render(<ConnectProviderView {...dialogProps()} source={erroredPositAi} onAction={onAction} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
		await user.click(screen.getByRole('button', { name: 'Disconnect' }));
		expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
		await act(async () => { resolveDisconnect(); });
	});

	it('shows no separate progress bar while an action is in flight', async () => {
		let resolve = () => { };
		const onAction = vi.fn().mockImplementation(() => new Promise<void>(r => { resolve = r; }));
		const user = userEvent.setup();
		rtl.render(<ConnectProviderView {...dialogProps()} source={positAi} onAction={onAction} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
		await user.click(screen.getByRole('button', { name: 'Connect' }));
		expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
		await act(async () => { resolve(); });
	});

	describe('with multiple auth methods (Databricks)', () => {
		it('names the auth method radio group', () => {
			rtl.render(<ConnectProviderView {...dialogProps()} source={databricksOAuth} onAction={async () => { }} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
			expect(screen.getByRole('radiogroup', { name: 'Authentication Method' })).toBeInTheDocument();
		});

		it('renders both radios with OAuth checked by default', () => {
			rtl.render(<ConnectProviderView {...dialogProps()} source={databricksOAuth} onAction={async () => { }} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
			expect(screen.getByRole('radio', { name: 'OAuth' })).toBeChecked();
			expect(screen.getByRole('radio', { name: 'API Key' })).not.toBeChecked();
			expect(screen.queryByLabelText(/api key/i, { selector: 'input[type="password"]' })).not.toBeInTheDocument();
		});

		it('reveals the API key input after selecting API Key', async () => {
			const user = userEvent.setup();
			rtl.render(<ConnectProviderView {...dialogProps()} source={databricksOAuth} onAction={async () => { }} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
			await user.click(screen.getByRole('radio', { name: 'API Key' }));
			expect(screen.getByRole('radio', { name: 'API Key' })).toBeChecked();
			expect(screen.getByLabelText(/api key/i, { selector: 'input[type="password"]' })).toBeInTheDocument();
		});

		it('clears a failed sign-in message when the method changes, keeping what was typed', async () => {
			const onAction = vi.fn().mockRejectedValue(new Error('Bad workspace URL'));
			const user = userEvent.setup();
			rtl.render(<ConnectProviderView {...dialogProps()} source={databricksOAuth} onAction={onAction} onBack={vi.fn()} />);
			await user.type(screen.getByLabelText('Workspace URL'), '/typed');
			await user.click(screen.getByRole('button', { name: 'Connect' }));
			expect(await screen.findByText('Bad workspace URL')).toBeInTheDocument();

			// The failure belonged to the method the user just left, so it goes; the
			// workspace URL is still theirs.
			await user.click(screen.getByRole('radio', { name: 'API Key' }));
			expect(screen.queryByText('Bad workspace URL')).not.toBeInTheDocument();
			expect(screen.getByLabelText('Workspace URL')).toHaveValue('https://workspace.example.com/typed');
		});

		it('keeps the workspace URL field visible under both methods', async () => {
			const user = userEvent.setup();
			rtl.render(<ConnectProviderView {...dialogProps()} source={databricksOAuth} onAction={async () => { }} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
			expect(screen.getByLabelText('Workspace URL')).toBeInTheDocument();
			await user.click(screen.getByRole('radio', { name: 'API Key' }));
			expect(screen.getByLabelText('Workspace URL')).toBeInTheDocument();
		});

		it('dispatches oauth-signin by default', async () => {
			const onAction = vi.fn().mockResolvedValue(undefined);
			const user = userEvent.setup();
			rtl.render(<ConnectProviderView {...dialogProps()} source={databricksOAuth} onAction={onAction} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
			await user.click(screen.getByRole('button', { name: 'Connect' }));
			expect(onAction).toHaveBeenCalledWith(databricksOAuth, expect.anything(), 'oauth-signin');
		});

		it('dispatches save with the API key after selecting API Key', async () => {
			const onAction = vi.fn().mockResolvedValue(undefined);
			const user = userEvent.setup();
			rtl.render(<ConnectProviderView {...dialogProps()} source={databricksOAuth} onAction={onAction} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
			await user.click(screen.getByRole('radio', { name: 'API Key' }));
			await user.type(screen.getByLabelText(/api key/i, { selector: 'input[type="password"]' }), 'placeholder-key');
			await user.click(screen.getByRole('button', { name: 'Connect' }));
			expect(onAction).toHaveBeenCalledWith(databricksOAuth, expect.objectContaining({ apiKey: 'placeholder-key' }), 'save');
		});

		it('hides the picker while signed in', () => {
			rtl.render(<ConnectProviderView {...dialogProps()} source={{ ...databricksOAuth, signedIn: true }} onAction={async () => { }} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
			expect(screen.queryByRole('radio', { name: 'OAuth' })).not.toBeInTheDocument();
		});

		it('disables the picker while a sign-in is in flight', async () => {
			let resolveSignIn = () => { };
			const onAction = vi.fn().mockImplementation(() => new Promise<void>(resolve => { resolveSignIn = resolve; }));
			const user = userEvent.setup();
			rtl.render(<ConnectProviderView {...dialogProps()} source={databricksOAuth} onAction={onAction} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
			await user.click(screen.getByRole('button', { name: 'Connect' }));
			expect(screen.getByRole('radio', { name: 'OAuth' })).toBeDisabled();
			expect(screen.getByRole('radio', { name: 'API Key' })).toBeDisabled();
			await act(async () => { resolveSignIn(); });
		});
	});

	describe('AWS profile and region', () => {
		it('renders both inputs prefilled from the saved values', () => {
			rtl.render(<ConnectProviderView {...dialogProps()} source={bedrock} onAction={async () => { }} onBack={vi.fn()} />);
			expect(screen.getByLabelText(/aws profile/i)).toHaveValue('data-team');
			expect(screen.getByLabelText(/aws region/i)).toHaveValue('eu-west-1');
		});

		// Profile only: `default` is what AWS looks for when none is given, a fixed
		// convention. The region has no equivalent worth promising, so its box
		// stays bare rather than suggesting a value that may not apply.
		it('hints the profile AWS falls back to, and hints nothing for the region', () => {
			rtl.render(<ConnectProviderView {...dialogProps()} source={bedrock} onAction={async () => { }} onBack={vi.fn()} />);
			expect(screen.getByLabelText(/aws profile/i)).toHaveAttribute('placeholder', 'default');
			expect(screen.getByLabelText(/aws region/i)).not.toHaveAttribute('placeholder');
		});

		it('renders neither input for a provider that does not support them', () => {
			rtl.render(<ConnectProviderView {...dialogProps()} source={anthropic} onAction={async () => { }} onBack={vi.fn()} />);
			expect(screen.queryByLabelText(/aws profile/i)).not.toBeInTheDocument();
			expect(screen.queryByLabelText(/aws region/i)).not.toBeInTheDocument();
		});

		it('leaves Connect enabled with both boxes empty, since both fields are optional', async () => {
			const user = userEvent.setup();
			rtl.render(<ConnectProviderView {...dialogProps()} source={bedrock} onAction={async () => { }} onBack={vi.fn()} />);
			await user.clear(screen.getByLabelText(/aws profile/i));
			await user.clear(screen.getByLabelText(/aws region/i));
			expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled();
		});

		it('dispatches edited values, trimmed', async () => {
			const onAction = vi.fn().mockResolvedValue(undefined);
			const user = userEvent.setup();
			rtl.render(<ConnectProviderView {...dialogProps()} source={bedrock} onAction={onAction} onBack={vi.fn()} />);
			const region = screen.getByLabelText(/aws region/i);
			await user.clear(region);
			await user.type(region, '  us-west-2  ');
			await user.click(screen.getByRole('button', { name: 'Connect' }));
			expect(onAction).toHaveBeenCalledWith(
				bedrock,
				expect.objectContaining({ aws: { profile: 'data-team', region: 'us-west-2' } }),
				'save',
			);
		});

		it('dispatches an emptied box as an empty string, the signal to remove the saved value', async () => {
			const onAction = vi.fn().mockResolvedValue(undefined);
			const user = userEvent.setup();
			rtl.render(<ConnectProviderView {...dialogProps()} source={bedrock} onAction={onAction} onBack={vi.fn()} />);
			await user.clear(screen.getByLabelText(/aws profile/i));
			await user.click(screen.getByRole('button', { name: 'Connect' }));
			expect(onAction).toHaveBeenCalledWith(
				bedrock,
				expect.objectContaining({ aws: { profile: '', region: 'eu-west-1' } }),
				'save',
			);
		});

		describe('a field the environment overrides', () => {
			it('shows the value in effect read-only, naming the variable and the value it shadows', () => {
				rtl.render(<ConnectProviderView {...dialogProps()} source={bedrockRegionFromEnv} onAction={async () => { }} onBack={vi.fn()} />);
				const region = screen.getByLabelText(/aws region/i);
				expect(region).toHaveValue('us-east-2');
				expect(region).toHaveAttribute('readonly');
				expect(screen.getByTestId('aws-region-override')).toHaveTextContent(
					'Using AWS_REGION. Unset it to use your saved value: eu-west-1'
				);
				// The shadowed value carries its own monospace element rather than
				// being interpolated into the sentence, so it can't be mistaken for
				// prose. `eu-west-1` is text only here -- the inputs hold it as a
				// value, which getByText does not match.
				expect(screen.getByText('eu-west-1')).toHaveClass('connect-provider-override-value');
			});

			it('omits the shadowed-value clause when the user has nothing saved underneath', () => {
				const source: IPositronLanguageModelSource = {
					...bedrockRegionFromEnv,
					defaults: { aws: { profile: 'data-team' } },
				};
				rtl.render(<ConnectProviderView {...dialogProps()} source={source} onAction={async () => { }} onBack={vi.fn()} />);
				expect(screen.getByTestId('aws-region-override')).toHaveTextContent(/^Using AWS_REGION\.$/);
			});

			it('names the layer generically when the override carries no variable name', () => {
				const source: IPositronLanguageModelSource = {
					...bedrock,
					defaults: { aws: {} },
					overrides: { aws: { region: { value: 'us-east-2' } } },
				};
				rtl.render(<ConnectProviderView {...dialogProps()} source={source} onAction={async () => { }} onBack={vi.fn()} />);
				expect(screen.getByTestId('aws-region-override')).toHaveTextContent(/^Using an environment variable\.$/);
			});

			it('leaves the sibling field editable and unannotated', () => {
				rtl.render(<ConnectProviderView {...dialogProps()} source={bedrockRegionFromEnv} onAction={async () => { }} onBack={vi.fn()} />);
				expect(screen.getByLabelText(/aws profile/i)).not.toHaveAttribute('readonly');
				expect(screen.queryByTestId('aws-profile-override')).not.toBeInTheDocument();
			});

			// Submitting the displayed value would persist a variable that may not
			// be set next launch; submitting an empty string would delete what the
			// user saved under it. Omitting the key leaves the saved value alone.
			it('is left out of the dispatch while the editable sibling is submitted', async () => {
				const onAction = vi.fn().mockResolvedValue(undefined);
				const user = userEvent.setup();
				rtl.render(<ConnectProviderView {...dialogProps()} source={bedrockRegionFromEnv} onAction={onAction} onBack={vi.fn()} />);
				await user.click(screen.getByRole('button', { name: 'Connect' }));
				expect(onAction).toHaveBeenCalledWith(
					bedrockRegionFromEnv,
					expect.objectContaining({ aws: { profile: 'data-team' } }),
					'save',
				);
			});

			// Empty rather than the saved values inherited from `defaults`, so the
			// save handler can tell "nothing editable was submitted" from "the
			// user cleared these boxes" and skip the write entirely.
			it('submits an empty aws block when neither field is editable', async () => {
				const onAction = vi.fn().mockResolvedValue(undefined);
				const user = userEvent.setup();
				rtl.render(<ConnectProviderView {...dialogProps()} source={bedrockBothFromEnv} onAction={onAction} onBack={vi.fn()} />);
				await user.click(screen.getByRole('button', { name: 'Connect' }));
				expect(onAction).toHaveBeenCalledWith(
					bedrockBothFromEnv,
					expect.objectContaining({ aws: {} }),
					'save',
				);
			});

			// Parked: the hint paragraph these cover is commented out in
			// connectProviderView.tsx pending a decision on whether to keep it.
			// Re-enable both alongside uncommenting it -- the first is vacuous
			// while nothing renders, and the second asserts the reduced wording.
			it.skip('drops the hint when neither field is editable, since there is nothing to leave blank', () => {
				rtl.render(<ConnectProviderView {...dialogProps()} source={bedrockBothFromEnv} onAction={async () => { }} onBack={vi.fn()} />);
				expect(screen.queryByText(/Leave blank/)).not.toBeInTheDocument();
			});

			// With one variable set, naming the pair would imply the set one is
			// still a fallback; its own note already names it.
			it.skip('reduces the hint to the AWS defaults when one field is still editable', () => {
				rtl.render(<ConnectProviderView {...dialogProps()} source={bedrockRegionFromEnv} onAction={async () => { }} onBack={vi.fn()} />);
				expect(screen.getByText('Leave blank to use your AWS defaults.')).toBeInTheDocument();
			});
		});
	});
});
