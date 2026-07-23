/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { IPositronLanguageModelConfig, IPositronLanguageModelSource, LanguageModelAutoconfigureType, PositronLanguageModelType } from '../../common/interfaces/positronAssistantService.js';
import { ConnectProviderView, ConnectProviderViewProps } from '../../browser/components/connectProviderView.js';
import { deriveConnectAction } from '../../browser/providerConnection.js';

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

	// Render with no-op handlers by default; individual tests override the one
	// they exercise. The modal owns the source argument and action verbs, so the
	// view only exposes the three intents connect / remove / cancel-sign-in.
	const renderView = (
		source: IPositronLanguageModelSource,
		props: Partial<ConnectProviderViewProps> = {},
	) => rtl.render(
		<ConnectProviderView
			source={source}
			onBack={vi.fn()}
			onCancelSignIn={vi.fn()}
			onClose={vi.fn()}
			onConnect={async () => { }}
			onRemove={async () => { }}
			{...props}
		/>
	);

	it('renders a Connect footer button and legal text for Posit AI', () => {
		renderView(positAi);
		expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled();
		expect(screen.getByTestId('provider-notice')).toBeInTheDocument();
	});

	it('invokes onConnect when Connect is clicked', async () => {
		const onConnect = vi.fn().mockResolvedValue(undefined);
		const user = userEvent.setup();
		renderView(positAi, { onConnect });
		await user.click(screen.getByRole('button', { name: 'Connect' }));
		expect(onConnect).toHaveBeenCalledWith({});
	});

	it('invokes onBack and onClose from the footer buttons', async () => {
		const onBack = vi.fn();
		const onClose = vi.fn();
		const user = userEvent.setup();
		renderView(positAi, { onBack, onClose });
		await user.click(screen.getByRole('button', { name: 'Back' }));
		await user.click(screen.getByRole('button', { name: 'Close' }));
		expect(onBack).toHaveBeenCalled();
		expect(onClose).toHaveBeenCalled();
	});

	it('reports a cancel handler while an OAuth sign-in is in progress that invokes onCancelSignIn', async () => {
		let resolveSignIn = () => { };
		const onConnect = vi.fn().mockImplementation(() => new Promise<void>(resolve => { resolveSignIn = resolve; }));
		const onCancelSignIn = vi.fn();
		let reportedCancel: (() => void) | undefined;
		const user = userEvent.setup();
		renderView(positAi, { onConnect, onCancelSignIn, onPendingSignInChange: cancel => { reportedCancel = cancel; } });
		expect(reportedCancel).toBeUndefined();
		await user.click(screen.getByRole('button', { name: 'Connect' }));
		expect(reportedCancel).toBeTypeOf('function');
		reportedCancel!();
		expect(onCancelSignIn).toHaveBeenCalled();
		await act(async () => { resolveSignIn(); });
	});

	it('shows a failed sign-in in the error banner', async () => {
		const onConnect = vi.fn().mockRejectedValue(new Error('Bad key'));
		const user = userEvent.setup();
		renderView(positAi, { onConnect });
		await user.click(screen.getByRole('button', { name: 'Connect' }));
		expect(await screen.findByText('Bad key')).toBeInTheDocument();
	});

	it('renders an API key input for an API-key provider', () => {
		renderView(anthropic);
		expect(screen.getByLabelText(/api key/i)).toBeInTheDocument();
	});

	it('disables Connect until an API key is entered', async () => {
		const user = userEvent.setup();
		renderView(anthropic);
		expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
		await user.type(screen.getByLabelText(/api key/i), 'sk-test');
		expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled();
	});

	it('passes the entered API key to onConnect when Connect is clicked', async () => {
		const onConnect = vi.fn().mockResolvedValue(undefined);
		const user = userEvent.setup();
		renderView(anthropic, { onConnect });
		await user.type(screen.getByLabelText(/api key/i), 'sk-test');
		await user.click(screen.getByRole('button', { name: 'Connect' }));
		expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'sk-test' }));
	});

	it('renders a base URL input prefilled with the current value', () => {
		renderView(anthropic);
		expect(screen.getByLabelText(/base url/i)).toHaveValue('https://api.anthropic.com');
	});

	it('includes an edited base URL in the config passed to onConnect', async () => {
		const onConnect = vi.fn().mockResolvedValue(undefined);
		const user = userEvent.setup();
		renderView(anthropic, { onConnect });
		await user.type(screen.getByLabelText(/api key/i), 'sk-test');
		const baseUrlInput = screen.getByLabelText(/base url/i);
		await user.clear(baseUrlInput);
		await user.type(baseUrlInput, 'https://proxy.example/v1');
		await user.click(screen.getByRole('button', { name: 'Connect' }));
		expect(onConnect).toHaveBeenCalledWith(
			expect.objectContaining({ apiKey: 'sk-test', baseUrl: 'https://proxy.example/v1' }),
		);
	});

	it('shows the base URL input and no API key for a base-URL-only provider', () => {
		renderView(lmstudio);
		expect(screen.getByLabelText(/base url/i)).toHaveValue('http://localhost:1234/v1');
		expect(screen.queryByLabelText(/api key/i)).not.toBeInTheDocument();
	});

	it('passes the base URL to onConnect for a base-URL-only provider', async () => {
		const onConnect = vi.fn().mockResolvedValue(undefined);
		const user = userEvent.setup();
		renderView(lmstudio, { onConnect });
		const baseUrlInput = screen.getByLabelText(/base url/i);
		await user.clear(baseUrlInput);
		await user.type(baseUrlInput, 'http://localhost:4321/v1');
		await user.click(screen.getByRole('button', { name: 'Connect' }));
		expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: 'http://localhost:4321/v1' }));
	});

	it('shows a spinner and "Connecting..." on the primary button while the sign-in is in flight', async () => {
		let resolveSignIn = () => { };
		const onConnect = vi.fn().mockImplementation(() => new Promise<void>(resolve => { resolveSignIn = resolve; }));
		const user = userEvent.setup();
		renderView(positAi, { onConnect });
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
		const onRemove = vi.fn().mockImplementation(() => new Promise<void>(resolve => { resolveRemove = resolve; }));
		const user = userEvent.setup();
		renderView(erroredAnthropic, { onRemove });
		await user.click(screen.getByRole('button', { name: 'Remove' }));
		expect(screen.getByRole('button', { name: 'Removing...' })).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
		await act(async () => { resolveRemove(); });
	});

	it('keeps Connect disabled while removing an errored, signed-in OAuth provider', async () => {
		const erroredPositAi = { ...positAi, signedIn: true, status: 'error' as const };
		let resolveRemove = () => { };
		const onRemove = vi.fn().mockImplementation(() => new Promise<void>(resolve => { resolveRemove = resolve; }));
		const user = userEvent.setup();
		renderView(erroredPositAi, { onRemove });
		await user.click(screen.getByRole('button', { name: 'Remove' }));
		expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
		await act(async () => { resolveRemove(); });
	});

	it('returns to the list (onBack) after a successful error-state remove', async () => {
		const erroredAnthropic = { ...anthropic, status: 'error' as const, signedIn: false };
		const onBack = vi.fn();
		const user = userEvent.setup();
		renderView(erroredAnthropic, { onRemove: async () => { }, onBack });
		await user.click(screen.getByRole('button', { name: 'Remove' }));
		expect(onBack).toHaveBeenCalled();
	});

	it('shows no separate progress bar while an action is in flight', async () => {
		let resolve = () => { };
		const onConnect = vi.fn().mockImplementation(() => new Promise<void>(r => { resolve = r; }));
		const user = userEvent.setup();
		renderView(positAi, { onConnect });
		await user.click(screen.getByRole('button', { name: 'Connect' }));
		expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
		await act(async () => { resolve(); });
	});
});

/**
 * Snapshot of the language model providers registered by the Posit Assistant
 * extension, captured from `getRegisteredSources()` in a running Positron.
 * Kept inline in this test file (rather than a standalone module) so it never
 * enters the app TypeScript build; it drives the sign-in dispatch matrix below.
 *
 * To refresh: log the return of `getRegisteredSources()` and paste it here,
 * applying the fixups (`type` -> enum, drop `undefined` fields, single quotes).
 */
const REGISTERED_PROVIDERS: IPositronLanguageModelSource[] = [
	{
		type: PositronLanguageModelType.Chat,
		provider: {
			id: 'anthropic-api',
			displayName: 'Anthropic',
			settingName: 'anthropic'
		},
		supportedOptions: [
			'apiKey',
			'baseUrl',
			'autoconfigure'
		],
		defaults: {
			model: 'claude-sonnet-4-latest',
			baseUrl: 'https://api.anthropic.com',
			toolCalls: true,
			autoconfigure: {
				type: LanguageModelAutoconfigureType.EnvVariable,
				key: 'ANTHROPIC_API_KEY',
				signedIn: false
			}
		},
		signedIn: false,
		status: null
	},
	{
		type: PositronLanguageModelType.Chat,
		provider: {
			id: 'posit-ai',
			displayName: 'Posit AI',
			settingName: 'positAI'
		},
		supportedOptions: [
			'oauth'
		],
		defaults: {
			model: 'claude-sonnet-4-5-20250929',
			toolCalls: true,
			oauth: true
		},
		signedIn: false,
		status: null
	},
	{
		type: PositronLanguageModelType.Chat,
		provider: {
			id: 'amazon-bedrock',
			displayName: 'Amazon Bedrock',
			settingName: 'amazonBedrock'
		},
		supportedOptions: [
			'toolCalls'
		],
		defaults: {
			model: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
			toolCalls: true
		},
		signedIn: false,
		statusMessage: 'Authentication expired',
		status: 'error'
	},
	{
		type: PositronLanguageModelType.Chat,
		provider: {
			id: 'ms-foundry',
			displayName: 'Microsoft Foundry',
			settingName: 'msFoundry'
		},
		supportedOptions: [
			'apiKey',
			'baseUrl',
			'toolCalls'
		],
		defaults: {
			model: 'model-router',
			toolCalls: true
		},
		signedIn: false,
		status: null
	},
	{
		type: PositronLanguageModelType.Chat,
		provider: {
			id: 'snowflake-cortex',
			displayName: 'Snowflake Cortex',
			settingName: 'snowflakeCortex'
		},
		supportedOptions: [
			'apiKey',
			'baseUrl',
			'toolCalls',
			'autoconfigure'
		],
		defaults: {
			model: 'claude-4-sonnet',
			baseUrl: '',
			toolCalls: true,
			autoconfigure: {
				type: LanguageModelAutoconfigureType.Custom,
				message: 'Snowflake credentials',
				signedIn: false
			}
		},
		signedIn: false,
		status: null
	},
	{
		type: PositronLanguageModelType.Chat,
		provider: {
			id: 'openai-api',
			displayName: 'OpenAI',
			settingName: 'openAI'
		},
		supportedOptions: [
			'apiKey',
			'baseUrl',
			'toolCalls'
		],
		defaults: {
			model: 'openai',
			baseUrl: 'https://api.openai.com/v1',
			toolCalls: true
		},
		signedIn: false,
		status: null
	},
	{
		type: PositronLanguageModelType.Chat,
		provider: {
			id: 'google',
			displayName: 'Google Gemini',
			settingName: 'google',
			status: 'experimental'
		},
		supportedOptions: [
			'baseUrl',
			'apiKey'
		],
		defaults: {
			model: 'gemini-2.5-flash',
			baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
			toolCalls: true
		},
		signedIn: false,
		status: null
	},
	{
		type: PositronLanguageModelType.Chat,
		provider: {
			id: 'google-cloud',
			displayName: 'Gemini Enterprise Agent Platform',
			settingName: 'googleVertex',
			status: 'experimental'
		},
		supportedOptions: [
			'baseUrl',
			'toolCalls'
		],
		defaults: {
			model: 'gemini-2.5-flash',
			baseUrl: 'https://aiplatform.googleapis.com',
			toolCalls: true
		},
		signedIn: false,
		status: null
	},
	{
		type: PositronLanguageModelType.Chat,
		provider: {
			id: 'copilot-auth',
			displayName: 'GitHub Copilot',
			settingName: 'githubCopilot',
			status: 'preview'
		},
		supportedOptions: [
			'oauth',
			'autoconfigure'
		],
		defaults: {
			model: 'github-copilot',
			autoconfigure: {
				type: LanguageModelAutoconfigureType.Custom,
				message: 'the Accounts menu.',
				signedIn: false
			}
		},
		signedIn: false,
		status: null
	},
	{
		type: PositronLanguageModelType.Chat,
		provider: {
			id: 'openai-compatible',
			displayName: 'Custom Provider',
			settingName: 'customProvider',
			status: 'experimental'
		},
		supportedOptions: [
			'apiKey',
			'baseUrl',
			'toolCalls'
		],
		defaults: {
			model: 'openai-compatible',
			baseUrl: 'https://localhost:1337/v1',
			toolCalls: true
		},
		signedIn: false,
		status: null
	},
	{
		type: PositronLanguageModelType.Chat,
		provider: {
			id: 'deepseek-api',
			displayName: 'DeepSeek',
			settingName: 'deepseek',
			status: 'experimental'
		},
		supportedOptions: [
			'apiKey',
			'baseUrl',
			'autoconfigure'
		],
		defaults: {
			model: 'deepseek-chat',
			baseUrl: 'https://api.deepseek.com',
			toolCalls: true,
			autoconfigure: {
				type: LanguageModelAutoconfigureType.EnvVariable,
				key: 'DEEPSEEK_API_KEY',
				signedIn: false
			}
		},
		signedIn: false,
		status: null
	},
	{
		type: PositronLanguageModelType.Chat,
		provider: {
			id: 'ollama',
			displayName: 'Ollama',
			settingName: 'ollama',
			status: 'experimental',
		},
		supportedOptions: [
			'baseUrl'
		],
		defaults: {
			baseUrl: 'http://localhost:11434'
		},
		signedIn: false
	},
	{
		type: PositronLanguageModelType.Chat,
		provider: {
			id: 'lmstudio',
			displayName: 'LM Studio',
			settingName: 'lmStudio',
			status: 'experimental'
		},
		supportedOptions: [
			'baseUrl'
		],
		defaults: {
			baseUrl: 'http://localhost:1234/v1'
		},
		signedIn: true,
		status: 'ok'
	}
];

/**
 * A row describes signing in to one real registered provider: what the user
 * types into the form, and the exact dispatch the LEGACY modal produced -- the
 * `(config, action)` it passed to `onAction`. Sourced against the captured
 * `REGISTERED_PROVIDERS` fixture so the matrix tracks the real provider set.
 */
interface SignInRow {
	/** Provider id to look up in the fixture. */
	id: string;
	/** Optional label for the test title, to disambiguate multiple rows for the same provider. */
	testLabel?: string;
	/** What the user types before clicking Connect (omit fields for OAuth / no-auth providers). */
	input?: { apiKey?: string; baseUrl?: string };
	/** The dispatch the legacy UI produced for this sign-in. */
	expected: { config: IPositronLanguageModelConfig; action: string };
}

describe('ConnectProviderView sign-in dispatch (registered providers)', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	// One row per registered provider. `expected` is the dispatch the legacy
	// modal produced when signing in: config = `{...source.defaults, apiKey?}`
	// (API key merged only for API-key providers), action = 'oauth-signin' for
	// OAuth providers else 'save' -- matching `languageModelModalDialog.onSignIn`.
	// Derived from the captured fixture defaults with 'foo' as the API-key
	// placeholder; refresh alongside the fixture if provider defaults change.
	const SIGN_IN_MATRIX: SignInRow[] = [
		{
			id: 'ollama',
			expected: {
				config: {
					baseUrl: 'http://localhost:11434'
				},
				action: 'save',
			},
		},
		{
			id: 'lmstudio',
			expected: {
				config: {
					baseUrl: 'http://localhost:1234/v1'
				},
				action: 'save',
			},
		},
		{
			id: 'anthropic-api',
			input: { apiKey: 'foo' },
			expected: {
				config: {
					model: 'claude-sonnet-4-latest',
					baseUrl: 'https://api.anthropic.com',
					toolCalls: true,
					autoconfigure: {
						type: LanguageModelAutoconfigureType.EnvVariable,
						key: 'ANTHROPIC_API_KEY',
						signedIn: false
					},
					apiKey: 'foo'
				},
				action: 'save',
			},
		},
		{
			id: 'posit-ai',
			expected: {
				config: {
					model: 'claude-sonnet-4-5-20250929',
					toolCalls: true,
					oauth: true
				},
				action: 'oauth-signin',
			},
		},
		{
			id: 'amazon-bedrock',
			expected: {
				config: {
					model: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
					toolCalls: true
				},
				action: 'save',
			},
		},
		{
			id: 'ms-foundry',
			input: { apiKey: 'foo' },
			expected: {
				config: {
					model: 'model-router',
					baseUrl: '',
					toolCalls: true,
					apiKey: 'foo',
				},
				action: 'save',
			},
		},
		{
			id: 'snowflake-cortex',
			testLabel: 'snowflake-cortex (custom account)',
			input: { apiKey: 'foo', baseUrl: 'accountIdentifier' },
			expected: {
				config: {
					model: 'claude-4-sonnet',
					toolCalls: true,
					autoconfigure: {
						type: LanguageModelAutoconfigureType.Custom,
						message: 'Snowflake credentials',
						signedIn: false
					},
					apiKey: 'foo',
					baseUrl: 'accountIdentifier'
				},
				action: 'save',
			},
		},
		{
			id: 'snowflake-cortex',
			testLabel: 'snowflake-cortex (default account)',
			input: { apiKey: 'foo' },
			expected: {
				config: {
					model: 'claude-4-sonnet',
					baseUrl: '',
					toolCalls: true,
					autoconfigure: {
						type: LanguageModelAutoconfigureType.Custom,
						message: 'Snowflake credentials',
						signedIn: false
					},
					apiKey: 'foo'
				},
				action: 'save',
			},
		},
		{
			id: 'openai-api',
			input: { apiKey: 'foo' },
			expected: {
				config: {
					model: 'openai',
					baseUrl: 'https://api.openai.com/v1',
					toolCalls: true,
					apiKey: 'foo'
				},
				action: 'save',
			},
		},
		{
			id: 'google',
			input: { apiKey: 'foo' },
			expected: {
				config: {
					model: 'gemini-2.5-flash',
					baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
					toolCalls: true,
					apiKey: 'foo'
				},
				action: 'save',
			},
		},
		{
			id: 'google-cloud',
			expected: {
				config: {
					model: 'gemini-2.5-flash',
					baseUrl: 'https://aiplatform.googleapis.com',
					toolCalls: true
				},
				action: 'save',
			},
		},
		{
			id: 'copilot-auth',
			expected: {
				config: {
					model: 'github-copilot',
					autoconfigure: {
						type: LanguageModelAutoconfigureType.Custom,
						message: 'the Accounts menu.',
						signedIn: false
					}
				},
				action: 'oauth-signin',
			},
		},
		{
			id: 'openai-compatible',
			input: { apiKey: 'foo' },
			expected: {
				config: {
					model: 'openai-compatible',
					baseUrl: 'https://localhost:1337/v1',
					toolCalls: true,
					apiKey: 'foo'
				},
				action: 'save',
			},
		},
		{
			id: 'deepseek-api',
			input: { apiKey: 'foo' },
			expected: {
				config: {
					model: 'deepseek-chat',
					baseUrl: 'https://api.deepseek.com',
					toolCalls: true,
					autoconfigure: {
						type: LanguageModelAutoconfigureType.EnvVariable,
						key: 'DEEPSEEK_API_KEY',
						signedIn: false
					},
					apiKey: 'foo'
				},
				action: 'save',
			},
		},
	];

	// Give each case a stable title: the explicit testLabel when set (to tell
	// apart multiple rows for one provider), otherwise the provider id.
	const signInCases = SIGN_IN_MATRIX.map(row => ({ ...row, title: row.testLabel ?? row.id }));

	it.each(signInCases)('signs in to $title with the legacy config and action', async ({ id, input, expected }) => {
		const source = REGISTERED_PROVIDERS.find(s => s.provider.id === id);
		if (!source) {
			throw new Error(`Provider '${id}' is not in the registered-providers fixture`);
		}
		// Sign-in is the pre-authenticated flow; a fixture entry may show the
		// provider as already signed in, which would disable the Connect button.
		const signInSource: IPositronLanguageModelSource = { ...source, signedIn: false };

		// Mirror the modal's real wiring: it owns the source argument and derives
		// the action verb, handing the view only an onConnect(config) callback.
		const onAction = vi.fn().mockResolvedValue(undefined);
		const user = userEvent.setup();
		rtl.render(
			<ConnectProviderView
				source={signInSource}
				onBack={vi.fn()}
				onCancelSignIn={vi.fn()}
				onClose={vi.fn()}
				onConnect={config => onAction(signInSource, config, deriveConnectAction(signInSource))}
				onRemove={async () => { }}
			/>
		);

		if (input?.apiKey !== undefined) {
			await user.type(screen.getByLabelText(/api key/i), input.apiKey);
		}
		if (input?.baseUrl !== undefined) {
			const baseUrlInput = screen.getByLabelText(/base url/i);
			await user.clear(baseUrlInput);
			await user.type(baseUrlInput, input.baseUrl);
		}

		await user.click(screen.getByRole('button', { name: 'Connect' }));

		expect(onAction).toHaveBeenCalledWith(signInSource, expected.config, expected.action);
	});
});
