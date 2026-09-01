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
import { dialogProps } from './providerModalTestUtils.js';

const positAi: IPositronLanguageModelSource = {
	type: PositronLanguageModelType.Chat,
	provider: { id: 'posit-ai', displayName: 'Posit AI Pass' },
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
		rtl.render(<ConnectedProviderView {...dialogProps()} source={positAi} onAction={async () => { }} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
		expect(screen.getByText(/connected via oauth/i)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Sign Out' })).toBeInTheDocument();
	});

	it('dispatches oauth-signout when the footer action runs', async () => {
		const onAction = vi.fn().mockResolvedValue(undefined);
		const user = userEvent.setup();
		rtl.render(<ConnectedProviderView {...dialogProps()} source={positAi} onAction={onAction} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
		await user.click(screen.getByRole('button', { name: 'Sign Out' }));
		expect(onAction).toHaveBeenCalledWith(positAi, expect.anything(), 'oauth-signout');
	});

	it('displays the current base URL for a provider that supports it', () => {
		const anthropic: IPositronLanguageModelSource = {
			type: PositronLanguageModelType.Chat,
			provider: { id: 'anthropic-api', displayName: 'Anthropic' },
			supportedOptions: ['apiKey', 'baseUrl'],
			signedIn: true,
			defaults: { baseUrl: 'https://proxy.example/v1' },
		};
		rtl.render(<ConnectedProviderView {...dialogProps()} source={anthropic} onAction={async () => { }} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
		expect(screen.getByText('https://proxy.example/v1')).toBeInTheDocument();
	});

	it('labels the Databricks base URL row as the workspace URL', () => {
		const databricks: IPositronLanguageModelSource = {
			type: PositronLanguageModelType.Chat,
			provider: { id: 'databricks', displayName: 'Databricks' },
			supportedOptions: ['apiKey', 'baseUrl'],
			signedIn: true,
			defaults: { baseUrl: 'https://workspace.example.com' },
		};
		rtl.render(<ConnectedProviderView {...dialogProps()} source={databricks} onAction={async () => { }} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
		expect(screen.getByText('Workspace URL')).toBeInTheDocument();
		expect(screen.queryByText('Base URL')).not.toBeInTheDocument();
	});

	it('omits the base URL row when the provider does not support it', () => {
		rtl.render(<ConnectedProviderView {...dialogProps()} source={positAi} onAction={async () => { }} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
		expect(screen.queryByText(/base url/i)).not.toBeInTheDocument();
		// The row's element goes too, not just its text. It used to render empty
		// and grow to fill the body, pushing the notice down against the footer.
		expect(screen.queryByTestId('provider-base-url')).not.toBeInTheDocument();
	});

	it('shows an error banner (and not the connected line) when the provider status is error', () => {
		const broken: IPositronLanguageModelSource = {
			type: PositronLanguageModelType.Chat,
			provider: { id: 'anthropic-api', displayName: 'Anthropic' },
			supportedOptions: ['apiKey', 'baseUrl'],
			signedIn: true,
			status: 'error',
			statusMessage: 'Bad base URL',
			defaults: {},
		};
		rtl.render(<ConnectedProviderView {...dialogProps()} source={broken} onAction={async () => { }} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
		expect(screen.getByText('Bad base URL')).toBeInTheDocument();
		expect(screen.queryByText(/connected to anthropic/i)).not.toBeInTheDocument();
	});

	it('shows the environment variable and no Disconnect footer button for env-authenticated providers', () => {
		const envAnthropic: IPositronLanguageModelSource = {
			type: PositronLanguageModelType.Chat,
			provider: { id: 'anthropic-api', displayName: 'Anthropic' },
			supportedOptions: ['apiKey', 'baseUrl', 'autoconfigure'],
			signedIn: true,
			defaults: {
				autoconfigure: { type: LanguageModelAutoconfigureType.EnvVariable, key: 'ANTHROPIC_API_KEY', signedIn: true },
			},
		};
		rtl.render(<ConnectedProviderView {...dialogProps()} source={envAnthropic} onAction={async () => { }} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
		expect(screen.getByText(/connected via ANTHROPIC_API_KEY/i)).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument();
	});

	it('shows the managed-credentials message and no Disconnect button for PWB-managed Databricks', () => {
		const managedDatabricks: IPositronLanguageModelSource = {
			type: PositronLanguageModelType.Chat,
			provider: { id: 'databricks', displayName: 'Databricks' },
			supportedOptions: ['oauth', 'apiKey', 'baseUrl', 'autoconfigure'],
			signedIn: true,
			defaults: {
				autoconfigure: { type: LanguageModelAutoconfigureType.Custom, message: 'OAuth (Workbench Managed Credentials)', signedIn: true },
			},
		};
		rtl.render(<ConnectedProviderView {...dialogProps()} source={managedDatabricks} onAction={async () => { }} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
		expect(screen.getByText(/connected via oauth \(workbench managed credentials\)/i)).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Sign Out' })).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument();
	});

	it('shows Accounts-menu sign-out guidance and no Disconnect for GitHub Copilot', () => {
		const copilot: IPositronLanguageModelSource = {
			type: PositronLanguageModelType.Chat,
			provider: { id: 'copilot-auth', displayName: 'GitHub Copilot' },
			supportedOptions: ['oauth', 'autoconfigure'],
			signedIn: true,
			defaults: {
				autoconfigure: { type: LanguageModelAutoconfigureType.Custom, message: 'the Accounts menu.', signedIn: true },
			},
		};
		rtl.render(<ConnectedProviderView {...dialogProps()} source={copilot} onAction={async () => { }} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
		expect(screen.getByRole('link', { name: /manage accounts/i })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Sign Out' })).not.toBeInTheDocument();
	});

	it('shows a spinner and "Signing Out..." on the button while signing out', async () => {
		let resolveSignOut = () => { };
		const onAction = vi.fn().mockImplementation(() => new Promise<void>(resolve => { resolveSignOut = resolve; }));
		const user = userEvent.setup();
		rtl.render(<ConnectedProviderView {...dialogProps()} source={positAi} onAction={onAction} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
		await user.click(screen.getByRole('button', { name: 'Sign Out' }));
		const signingOut = screen.getByRole('button', { name: 'Signing Out...' });
		expect(signingOut).toBeDisabled();
		// eslint-disable-next-line no-restricted-syntax -- decorative codicon spinner has no ARIA role
		expect(signingOut.querySelector('.codicon-modifier-spin')).toBeInTheDocument();
		await act(async () => { resolveSignOut(); });
	});

	it('shows "Disconnecting..." while clearing an API-key provider', async () => {
		const anthropic: IPositronLanguageModelSource = {
			type: PositronLanguageModelType.Chat,
			provider: { id: 'anthropic-api', displayName: 'Anthropic' },
			supportedOptions: ['apiKey', 'baseUrl'],
			signedIn: true,
			defaults: {},
		};
		let resolveDisconnect = () => { };
		const onAction = vi.fn().mockImplementation(() => new Promise<void>(resolve => { resolveDisconnect = resolve; }));
		const user = userEvent.setup();
		rtl.render(<ConnectedProviderView {...dialogProps()} source={anthropic} onAction={onAction} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
		await user.click(screen.getByRole('button', { name: 'Disconnect' }));
		expect(screen.getByRole('button', { name: 'Disconnecting...' })).toBeDisabled();
		await act(async () => { resolveDisconnect(); });
	});

	it('shows no separate progress bar while an action is in flight', async () => {
		let resolve = () => { };
		const onAction = vi.fn().mockImplementation(() => new Promise<void>(r => { resolve = r; }));
		const user = userEvent.setup();
		rtl.render(<ConnectedProviderView {...dialogProps()} source={positAi} onAction={onAction} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
		await user.click(screen.getByRole('button', { name: 'Sign Out' }));
		expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
		await act(async () => { resolve(); });
	});

	it('shows "Connected via API key" and a Disconnect action for a Databricks connection made with an API key, even though the provider also supports OAuth', async () => {
		const databricksApiKey: IPositronLanguageModelSource = {
			type: PositronLanguageModelType.Chat,
			provider: { id: 'databricks', displayName: 'Databricks' },
			supportedOptions: ['oauth', 'apiKey', 'baseUrl'],
			signedIn: true,
			authMethods: ['apiKey'],
			defaults: { baseUrl: 'https://workspace.example.com' },
		};
		const onAction = vi.fn().mockResolvedValue(undefined);
		const user = userEvent.setup();
		rtl.render(<ConnectedProviderView {...dialogProps()} source={databricksApiKey} onAction={onAction} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
		expect(screen.getByText(/connected via api key/i)).toBeInTheDocument();
		const disconnectButton = screen.getByRole('button', { name: 'Disconnect' });
		expect(disconnectButton).toBeInTheDocument();
		await user.click(disconnectButton);
		expect(onAction).toHaveBeenCalledWith(databricksApiKey, expect.anything(), 'delete');
	});

	it('shows "Connected via OAuth" and a Sign Out action for a Databricks connection made with OAuth', () => {
		const databricksOAuth: IPositronLanguageModelSource = {
			type: PositronLanguageModelType.Chat,
			provider: { id: 'databricks', displayName: 'Databricks' },
			supportedOptions: ['oauth', 'apiKey', 'baseUrl'],
			signedIn: true,
			authMethods: ['oauth'],
			defaults: { baseUrl: 'https://workspace.example.com' },
		};
		rtl.render(<ConnectedProviderView {...dialogProps()} source={databricksOAuth} onAction={async () => { }} onBack={vi.fn()} onEditRawConfig={vi.fn()} />);
		expect(screen.getByText(/connected via oauth/i)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Sign Out' })).toBeInTheDocument();
	});

	// A connected Bedrock provider is where most users land, since the AWS chain
	// usually resolves at activation -- so the values the connect form collects
	// have to be visible here rather than only behind Remove.
	const bedrock: IPositronLanguageModelSource = {
		type: PositronLanguageModelType.Chat,
		provider: { id: 'amazon-bedrock', displayName: 'Amazon Bedrock' },
		supportedOptions: ['toolCalls', 'aws'],
		signedIn: true,
		defaults: { aws: { profile: 'data-team', region: 'eu-west-1' } },
	};

	it('shows the saved AWS profile and region for a connected Bedrock provider', () => {
		rtl.render(<ConnectedProviderView {...dialogProps()} source={bedrock} onAction={async () => { }} onBack={vi.fn()} />);
		expect(screen.getByText('data-team')).toBeInTheDocument();
		expect(screen.getByText('eu-west-1')).toBeInTheDocument();
	});

	it('omits an AWS row that has no value from any layer', () => {
		const noneSaved = { ...bedrock, defaults: { aws: {} } };
		rtl.render(<ConnectedProviderView {...dialogProps()} source={noneSaved} onAction={async () => { }} onBack={vi.fn()} />);
		expect(screen.queryByText(/AWS Profile/)).not.toBeInTheDocument();
		expect(screen.queryByText(/AWS Region/)).not.toBeInTheDocument();
	});

	// `defaults` carries the user layer alone, so reading it by itself showed
	// nothing for a value the environment supplies -- while the connect form for
	// the same provider named it. These two views have to agree on what the
	// connection is actually using.
	it('shows an environment-supplied value the user never saved, naming the variable', () => {
		const fromEnv = {
			...bedrock,
			defaults: { aws: {} },
			overrides: { aws: { region: { value: 'us-east-2', name: 'AWS_REGION' } } },
		};
		rtl.render(<ConnectedProviderView {...dialogProps()} source={fromEnv} onAction={async () => { }} onBack={vi.fn()} />);
		expect(screen.getByTestId('provider-aws-region')).toHaveTextContent('AWS Region (from AWS_REGION)');
		expect(screen.getByText('us-east-2')).toBeInTheDocument();
	});

	it('prefers the environment value over the saved one, since that is what the connection uses', () => {
		const shadowed = {
			...bedrock,
			overrides: { aws: { region: { value: 'us-east-2', name: 'AWS_REGION' } } },
		};
		rtl.render(<ConnectedProviderView {...dialogProps()} source={shadowed} onAction={async () => { }} onBack={vi.fn()} />);
		expect(screen.getByTestId('provider-aws-region')).toHaveTextContent('us-east-2');
		expect(screen.queryByText('eu-west-1')).not.toBeInTheDocument();
	});

	it('leaves a row the user owns unannotated', () => {
		const shadowed = {
			...bedrock,
			overrides: { aws: { region: { value: 'us-east-2', name: 'AWS_REGION' } } },
		};
		rtl.render(<ConnectedProviderView {...dialogProps()} source={shadowed} onAction={async () => { }} onBack={vi.fn()} />);
		expect(screen.getByTestId('provider-aws-profile')).toHaveTextContent(/^AWS Profiledata-team$/);
	});

	it('omits the AWS rows for a provider that does not support them', () => {
		rtl.render(<ConnectedProviderView {...dialogProps()} source={positAi} onAction={async () => { }} onBack={vi.fn()} />);
		expect(screen.queryByText(/AWS Profile/)).not.toBeInTheDocument();
	});

	it('omits the detail group entirely when a provider has no details to show', () => {
		// The group is a flex child of a container with a 16px gap, so rendering
		// it empty would add that gap between the header and the notice for every
		// provider without details -- Posit AI here has neither baseUrl nor aws.
		rtl.render(<ConnectedProviderView {...dialogProps()} source={positAi} onAction={async () => { }} onBack={vi.fn()} />);
		expect(screen.queryByTestId('provider-details')).not.toBeInTheDocument();
	});

	it('groups the rows together when a provider has more than one detail', () => {
		const withBoth = { ...bedrock, supportedOptions: ['toolCalls', 'aws', 'baseUrl'] as typeof bedrock.supportedOptions, defaults: { baseUrl: 'https://bedrock.example.com', aws: { profile: 'data-team', region: 'eu-west-1' } } };
		rtl.render(<ConnectedProviderView {...dialogProps()} source={withBoth} onAction={async () => { }} onBack={vi.fn()} />);
		const group = screen.getByTestId('provider-details');
		expect(group).toContainElement(screen.getByTestId('provider-base-url'));
		expect(group).toContainElement(screen.getByTestId('provider-aws-profile'));
		expect(group).toContainElement(screen.getByTestId('provider-aws-region'));
	});
});
