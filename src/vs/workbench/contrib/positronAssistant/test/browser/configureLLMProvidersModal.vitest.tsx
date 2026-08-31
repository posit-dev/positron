/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Emitter } from '../../../../../base/common/event.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IPositronAssistantConfigurationService, IPositronLanguageModelConfig, IPositronLanguageModelSource, PositronLanguageModelType } from '../../common/interfaces/positronAssistantService.js';
import { AuthenticationSession, AuthenticationSessionsChangeEvent, IAuthenticationService } from '../../../../services/authentication/common/authentication.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ConfigureLLMProviders } from '../../browser/configureLLMProvidersModal.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { makeDialogRenderer } from './providerModalTestUtils.js';

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
	defaults: {},
};

const myGateway: IPositronLanguageModelSource = {
	type: PositronLanguageModelType.Chat,
	provider: { id: 'My Gateway', displayName: 'My Gateway', customKind: 'openai-compatible' },
	supportedOptions: ['apiKey', 'baseUrl'],
	signedIn: false,
	defaults: {},
};

describe('ConfigureLLMProviders', () => {
	const onChange = new Emitter<IPositronLanguageModelSource>();
	const registrationsChange = new Emitter<void>();
	const enabledProvidersChange = new Emitter<void>();
	const sessionsChange = new Emitter<{ providerId: string; label: string; event: AuthenticationSessionsChangeEvent }>();
	// syncAuthSessions only reads sessions.length, so an empty stub session suffices.
	let sessions: AuthenticationSession[] = [];
	// What the service reports after a registration change; the modal re-reads
	// it rather than patching its own list.
	let registeredSources: IPositronLanguageModelSource[] = [];
	// The add write is the extension's, reached by command; opening
	// providers.json for advanced editing goes through the same service.
	const executeCommand = vi.fn().mockResolvedValue(undefined);
	beforeEach(() => { sessions = []; registeredSources = []; executeCommand.mockClear(); });

	const ctx = createTestContainer()
		.withReactServices()
		.stub(IPositronAssistantConfigurationService, {
			onChangeProviderConfig: onChange.event,
			onChangeProviderRegistrations: registrationsChange.event,
			onChangeEnabledProviders: enabledProvidersChange.event,
			getRegisteredSources: () => registeredSources,
		})
		.stub(IAuthenticationService, { onDidChangeSessions: sessionsChange.event, getSessions: async () => sessions })
		.stub(ICommandService, { executeCommand })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	function renderModal(
		sources: IPositronLanguageModelSource[],
		preselectedProviderId?: string,
		onAction: (source: IPositronLanguageModelSource, config: IPositronLanguageModelConfig, action: string) => Promise<void> = async () => { },
		renderer: PositronModalReactRenderer = makeDialogRenderer(),
	) {
		return rtl.render(
			<ConfigureLLMProviders
				preselectedProviderId={preselectedProviderId}
				renderer={renderer}
				sources={sources}
				onAction={onAction}
			/>
		);
	}

	it('opens on the provider list', () => {
		renderModal([anthropic]);
		expect(screen.getByText('Model Providers')).toBeInTheDocument();
	});

	it('opens on the connect view for a preselected signed-out provider', () => {
		renderModal([anthropic, positAi], 'anthropic-api');
		expect(screen.getByLabelText(/api key/i)).toBeInTheDocument();
		expect(screen.queryByText('Model Providers')).not.toBeInTheDocument();
	});

	it('opens on the connected view for a preselected signed-in provider', () => {
		renderModal([anthropic, { ...positAi, signedIn: true, status: 'ok' as const }], 'posit-ai');
		expect(screen.getByText(/connected via oauth/i)).toBeInTheDocument();
	});

	it('opens on the list when the preselected provider is not in the sources', () => {
		renderModal([anthropic], 'not-a-provider');
		expect(screen.getByText('Model Providers')).toBeInTheDocument();
	});

	it('returns to the list from a preselected provider', async () => {
		const user = userEvent.setup();
		renderModal([anthropic, positAi], 'anthropic-api');
		await user.click(screen.getByRole('button', { name: /back/i }));
		expect(screen.getByText('Model Providers')).toBeInTheDocument();
	});

	it('reflects a provider change fired while away from the list', async () => {
		// posit-ai starts connected (its row button is "Edit"), so anthropic's
		// "Connect" button is unambiguous.
		const connectedPositAi = { ...positAi, signedIn: true, status: 'ok' as const };
		const user = userEvent.setup();
		renderModal([anthropic, connectedPositAi]);
		expect(screen.getByText('Connected Providers')).toBeInTheDocument();

		// Navigate to the connect view (unmounting the list) ...
		await user.click(screen.getByRole('button', { name: /connect/i }));
		// ... then posit-ai signs out while the list is unmounted.
		act(() => onChange.fire({ ...positAi, signedIn: false, status: undefined }));

		await user.click(screen.getByRole('button', { name: /back/i }));
		expect(screen.queryByText('Connected Providers')).not.toBeInTheDocument();
	});

	it('advances from the connect view to the connected view when the provider signs in', async () => {
		const user = userEvent.setup();
		renderModal([positAi]);
		await user.click(screen.getByRole('button', { name: /connect/i }));
		act(() => onChange.fire({ ...positAi, signedIn: true }));
		expect(screen.getByText(/connected via oauth/i)).toBeInTheDocument();
	});

	it('advances to the connected view on an auth-session sign-in', async () => {
		const user = userEvent.setup();
		renderModal([positAi]);
		await user.click(screen.getByRole('button', { name: /connect/i }));
		sessions = [stubInterface<AuthenticationSession>()];
		await act(async () => {
			sessionsChange.fire({ providerId: 'posit-ai', label: 'Posit AI', event: { added: undefined, removed: undefined, changed: undefined } });
		});
		expect(screen.getByText(/connected via oauth/i)).toBeInTheDocument();
	});

	it('returns to the list when the connected provider signs out', async () => {
		const user = userEvent.setup();
		renderModal([{ ...positAi, signedIn: true, status: 'ok' as const }]);
		await user.click(screen.getByRole('button', { name: /edit/i }));
		expect(screen.getByText(/connected via oauth/i)).toBeInTheDocument();
		act(() => onChange.fire({ ...positAi, signedIn: false, status: undefined }));
		expect(screen.getByText('Model Providers')).toBeInTheDocument();
	});

	it('ignores a sign-in from a provider other than the selected one', async () => {
		// posit-ai starts connected (its row button is "Edit"), so anthropic's
		// "Connect" button is unambiguous regardless of the list's sort order.
		const connectedPositAi = { ...positAi, signedIn: true, status: 'ok' as const };
		const user = userEvent.setup();
		renderModal([anthropic, connectedPositAi]);
		await user.click(screen.getByRole('button', { name: /connect/i }));
		expect(screen.getByLabelText(/api key/i)).toBeInTheDocument();

		// posit-ai (not the selected provider) signs in while anthropic's
		// connect view is showing; the guard should keep the view unchanged.
		act(() => onChange.fire({ ...positAi, signedIn: true }));

		expect(screen.getByLabelText(/api key/i)).toBeInTheDocument();
		expect(screen.queryByText(/connected via/i)).not.toBeInTheDocument();
	});

	it('adds a provider that is registered while the modal is open', () => {
		renderModal([anthropic]);
		expect(screen.queryByText('My Gateway')).not.toBeInTheDocument();

		// A custom entry added to providers.json registers a source.
		registeredSources = [anthropic, myGateway];
		act(() => registrationsChange.fire());

		expect(screen.getByText('My Gateway')).toBeInTheDocument();
	});

	it('drops a provider that is unregistered while the modal is open', () => {
		renderModal([anthropic, myGateway]);
		expect(screen.getByText('My Gateway')).toBeInTheDocument();

		registeredSources = [anthropic];
		act(() => registrationsChange.fire());

		expect(screen.queryByText('My Gateway')).not.toBeInTheDocument();
		expect(screen.getByText('Anthropic')).toBeInTheDocument();
	});

	it('returns to the list when the provider being viewed is unregistered', async () => {
		// anthropic starts connected (its row button is "Edit"), so "Connect"
		// unambiguously belongs to My Gateway.
		const connectedAnthropic = { ...anthropic, signedIn: true, status: 'ok' as const };
		const user = userEvent.setup();
		renderModal([connectedAnthropic, myGateway]);
		await user.click(screen.getByRole('button', { name: /connect/i }));
		expect(screen.getByLabelText(/api key/i)).toBeInTheDocument();

		// The entry is deleted from providers.json while its connect view is open.
		registeredSources = [connectedAnthropic];
		act(() => registrationsChange.fire());

		expect(screen.getByText('Connected Providers')).toBeInTheDocument();
		expect(screen.queryByLabelText(/api key/i)).not.toBeInTheDocument();
	});

	it('shows no Back on the list view, and Back on the connect view', async () => {
		const user = userEvent.setup();
		renderModal([anthropic]);
		expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: /connect/i }));
		expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
	});

	it('gives the list view no footer, so dismissal is the title bar close button', () => {
		renderModal([anthropic]);
		expect(screen.getByRole('button', { name: 'Close' })).toHaveClass('title-bar-close-button');
	});

	// Closing the modal unmounts the React tree, which is what the connect view
	// hangs its cancel off, so dismissal aborts the device flow rather than
	// orphaning it.
	it('cancels an in-flight OAuth sign-in when the modal unmounts', async () => {
		let resolveSignIn = () => { };
		const onAction = vi.fn().mockImplementation((_source, _config, action) =>
			action === 'oauth-signin' ? new Promise<void>(resolve => { resolveSignIn = resolve; }) : Promise.resolve());
		const user = userEvent.setup();
		const { unmount } = renderModal([positAi], undefined, onAction);

		// The list row opens the connect view; its footer button starts the sign-in.
		await user.click(screen.getByRole('button', { name: /connect/i }));
		await user.click(screen.getByRole('button', { name: 'Connect' }));
		expect(onAction.mock.calls.map(([, , action]) => action)).toStrictEqual(['oauth-signin']);

		unmount();

		expect(onAction.mock.calls.map(([, , action]) => action)).toStrictEqual(['oauth-signin', 'cancel']);
		expect(onAction).toHaveBeenCalledWith(positAi, expect.anything(), 'cancel');
		await act(async () => { resolveSignIn(); });
	});

	// Back unmounts the connect view, so it cancels through the same path a close
	// does. The count matters: cancelling twice sends a second cancel to the provider.
	it('cancels an in-flight OAuth sign-in exactly once when Back returns to the list', async () => {
		const user = userEvent.setup();
		const actions: string[] = [];
		// Leave the sign-in pending so it is still in flight when Back is clicked.
		const onAction = (_s: IPositronLanguageModelSource, _c: IPositronLanguageModelConfig, action: string) => {
			actions.push(action);
			return action === 'oauth-signin' ? new Promise<void>(() => { }) : Promise.resolve();
		};
		renderModal([positAi], undefined, onAction);

		await user.click(screen.getByRole('button', { name: /connect/i }));
		await user.click(screen.getByRole('button', { name: 'Connect' }));
		expect(actions).toStrictEqual(['oauth-signin']);

		await user.click(screen.getByRole('button', { name: 'Back' }));
		expect(actions).toStrictEqual(['oauth-signin', 'cancel']);
		expect(screen.getByText('Model Providers')).toBeInTheDocument();
	});

	it('offers Edit providers.json on the connect view for both a custom entry and a built-in', async () => {
		const user = userEvent.setup();
		renderModal([anthropic, myGateway]);

		await user.click(screen.getAllByRole('button', { name: /connect/i })[1]);
		expect(screen.getByRole('button', { name: /edit providers\.json/i })).toBeInTheDocument();

		await user.click(screen.getByRole('button', { name: 'Back' }));
		await user.click(screen.getAllByRole('button', { name: /connect/i })[0]);
		expect(screen.getByRole('button', { name: /edit providers\.json/i })).toBeInTheDocument();
	});

	it('offers Edit providers.json on the connected view for a custom entry', async () => {
		const connectedGateway = { ...myGateway, signedIn: true, status: 'ok' as const };
		renderModal([connectedGateway], connectedGateway.provider.id);

		expect(screen.getByRole('button', { name: /edit providers\.json/i })).toBeInTheDocument();
	});

	it('opens providers.json and closes the modal from Edit providers.json', async () => {
		const user = userEvent.setup();
		const onDispose = vi.fn();
		renderModal([myGateway], undefined, undefined, makeDialogRenderer(onDispose));

		await user.click(screen.getByRole('button', { name: /connect/i }));
		await user.click(screen.getByRole('button', { name: /edit providers\.json/i }));

		expect(executeCommand).toHaveBeenCalledWith('workbench.action.positronAssistant.openAiProviderSettingsJson');
		expect(onDispose).toHaveBeenCalledTimes(1);
	});
});
