/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen, within } from '@testing-library/react';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { LanguageModelConfigComponent } from '../../browser/components/languageModelConfigComponent.js';
import { AuthMethod, AuthStatus } from '../../browser/types.js';
import { IPositronLanguageModelSource, PositronLanguageModelType } from '../../common/interfaces/positronAssistantService.js';

function makeSource(overrides?: Partial<Pick<IPositronLanguageModelSource, 'supportedOptions' | 'defaults'>> & { provider?: { id: string; displayName: string } }): IPositronLanguageModelSource {
	const provider = overrides?.provider ?? { id: 'anthropic-api', displayName: 'Anthropic' };
	return {
		type: PositronLanguageModelType.Chat,
		provider: { ...provider, settingName: provider.id },
		supportedOptions: overrides?.supportedOptions ?? [],
		defaults: overrides?.defaults ?? { model: '' },
	};
}

describe('LanguageModelConfigComponent ProviderNotice', () => {
	const ctx = createTestContainer().withReactServices().build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	function renderNotice(provider: { id: string; displayName: string }): HTMLElement {
		rtl.render(
			<LanguageModelConfigComponent
				authMethod={AuthMethod.NONE}
				authStatus={AuthStatus.SIGNED_OUT}
				closeDialog={() => { }}
				config={{ model: '' }}
				source={makeSource({ provider, supportedOptions: [] })}
				onCancel={() => { }}
				onChange={() => { }}
				onSignIn={() => { }}
			/>
		);

		return screen.getByTestId('provider-notice');
	}

	function linkHrefs(notice: HTMLElement): Record<string, string> {
		const result: Record<string, string> = {};
		for (const a of within(notice).queryAllByRole('link')) {
			result[a.textContent ?? ''] = a.getAttribute('href') ?? '';
		}
		return result;
	}

	it.each([
		{ id: 'posit-ai', displayName: 'Posit AI' },
		{ id: 'anthropic-api', displayName: 'Anthropic' },
		{ id: 'openai-compatible', displayName: 'Custom Provider' },
		{ id: 'unknown-provider', displayName: 'Some Provider' },
	])('renders a non-empty provider notice without placeholders for $id', (provider) => {
		const notice = renderNotice(provider);

		expect(notice).toHaveTextContent(/\S/);
		expect(notice).not.toHaveTextContent(/\{\d+\}/);
	});

	it('renders the terms, privacy, and Posit AI home links for posit-ai', () => {
		const notice = renderNotice({ id: 'posit-ai', displayName: 'Posit AI' });

		// Posit AI's Terms of Service link points to the Posit AI Agreement.
		expect(linkHrefs(notice)).toEqual({
			'Posit EULA': 'https://posit.co/about/eula/',
			'Terms of Service': 'https://posit.co/about/posit-ai-agreement',
			'Privacy Policy': 'https://posit.co/about/privacy-policy/',
			'Posit AI': 'https://posit.ai/',
		});
	});

	it('renders a known third-party provider with the Posit EULA plus its ToS and privacy links', () => {
		const notice = renderNotice({ id: 'anthropic-api', displayName: 'Anthropic' });

		// Third-party providers are "Third Party Materials" under the Posit EULA.
		expect(linkHrefs(notice)).toEqual({
			'Posit EULA': 'https://posit.co/about/eula/',
			'Terms of Service': 'https://www.anthropic.com/legal/consumer-terms',
			'Privacy Policy': 'https://www.anthropic.com/legal/privacy',
		});
	});

	it('renders the Posit EULA link plus unlinked labels for a provider with no ToS or privacy URLs', () => {
		const notice = renderNotice({ id: 'unknown-provider', displayName: 'Some Provider' });

		// The Posit EULA always links; the ToS/privacy fall back to plain text.
		expect(notice).toHaveTextContent('Terms of Service');
		expect(notice).toHaveTextContent('Privacy Policy');
		expect(linkHrefs(notice)).toEqual({
			'Posit EULA': 'https://posit.co/about/eula/',
		});
	});
});

describe('LanguageModelConfigComponent base-URL input', () => {
	const ctx = createTestContainer().withReactServices().build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	function renderConfig(supportedOptions: string[]) {
		rtl.render(
			<LanguageModelConfigComponent
				authMethod={AuthMethod.NONE}
				authStatus={AuthStatus.SIGNED_OUT}
				closeDialog={() => { }}
				config={{ model: '' }}
				source={makeSource({ supportedOptions })}
				onCancel={() => { }}
				onChange={() => { }}
				onSignIn={() => { }}
			/>
		);
	}

	it('renders the base-URL input when supportedOptions includes baseUrl', () => {
		renderConfig(['baseUrl']);

		expect(screen.getByLabelText('Base URL')).toBeInTheDocument();
	});

	it('does not render the base-URL input when supportedOptions is empty', () => {
		renderConfig([]);

		expect(screen.queryByLabelText('Base URL')).not.toBeInTheDocument();
	});
});
