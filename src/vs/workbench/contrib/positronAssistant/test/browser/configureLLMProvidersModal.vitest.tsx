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
import { ConfigureLLMProviders, PendingSignIn } from '../../browser/configureLLMProvidersModal.js';
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

describe('ConfigureLLMProviders', () => {
	const onChange = new Emitter<IPositronLanguageModelSource>();
	const sessionsChange = new Emitter<{ providerId: string; label: string; event: AuthenticationSessionsChangeEvent }>();
	// syncAuthSessions only reads sessions.length, so an empty stub session suffices.
	let sessions: AuthenticationSession[] = [];
	beforeEach(() => { sessions = []; });

	const ctx = createTestContainer()
		.withReactServices()
		.stub(IPositronAssistantConfigurationService, { onChangeProviderConfig: onChange.event })
		.stub(IAuthenticationService, { onDidChangeSessions: sessionsChange.event, getSessions: async () => sessions })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	function renderModal(
		sources: IPositronLanguageModelSource[],
		preselectedProviderId?: string,
		onAction: (source: IPositronLanguageModelSource, config: IPositronLanguageModelConfig, action: string) => Promise<void> = async () => { },
		pendingSignIn: PendingSignIn = {},
		renderer: PositronModalReactRenderer = makeDialogRenderer(),
	) {
		return rtl.render(
			<ConfigureLLMProviders
				pendingSignIn={pendingSignIn}
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

	// The renderer unmounts the React tree before it runs the teardown that cancels
	// an in-flight sign-in, so the handler has to outlive this component.
	it('leaves the pending sign-in handler in place when the modal unmounts', async () => {
		const pendingSignIn: PendingSignIn = {};
		let resolveSignIn = () => { };
		const onAction = vi.fn().mockImplementation((_source, _config, action) =>
			action === 'oauth-signin' ? new Promise<void>(resolve => { resolveSignIn = resolve; }) : Promise.resolve());
		const user = userEvent.setup();
		const { unmount } = renderModal([positAi], undefined, onAction, pendingSignIn);

		// The list row opens the connect view; its footer button starts the sign-in.
		await user.click(screen.getByRole('button', { name: /connect/i }));
		await user.click(screen.getByRole('button', { name: 'Connect' }));
		expect(pendingSignIn.cancel).toBeTypeOf('function');

		unmount();

		expect(pendingSignIn.cancel).toBeTypeOf('function');
		pendingSignIn.cancel!();
		expect(onAction).toHaveBeenCalledWith(positAi, expect.anything(), 'cancel');
		await act(async () => { resolveSignIn(); });
	});

	it('cancels an in-flight OAuth sign-in when Back returns to the list', async () => {
		const user = userEvent.setup();
		const actions: string[] = [];
		// Leave the sign-in pending so the connect view keeps reporting its cancel handler.
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
});
