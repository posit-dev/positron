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
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { IPositronAssistantConfigurationService, IPositronLanguageModelSource, PositronLanguageModelType } from '../../common/interfaces/positronAssistantService.js';
import { AuthenticationSession, AuthenticationSessionsChangeEvent, IAuthenticationService } from '../../../../services/authentication/common/authentication.js';
import { ConfigureLLMProviders } from '../../browser/configureLLMProvidersModal.js';

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

	// PositronModalDialog only uses onKeyDown/onResize from the renderer; close() calls dispose().
	function makeRenderer(): PositronModalReactRenderer {
		return stubInterface<PositronModalReactRenderer>({
			onKeyDown: new Emitter<KeyboardEvent>().event,
			onResize: new Emitter<UIEvent>().event,
			dispose: () => { },
		});
	}

	function renderModal(sources: IPositronLanguageModelSource[]) {
		return rtl.render(
			<ConfigureLLMProviders
				renderer={makeRenderer()}
				sources={sources}
				onAction={async () => { }}
				onClose={() => { }}
			/>
		);
	}

	it('opens on the provider list', () => {
		renderModal([anthropic]);
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

	it('shows Close without Back on the list view, and Back on the connect view', async () => {
		const user = userEvent.setup();
		renderModal([anthropic]);
		expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: /connect/i }));
		expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
	});
});
