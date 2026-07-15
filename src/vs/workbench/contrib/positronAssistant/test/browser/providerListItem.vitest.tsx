/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { userEvent } from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import { ProviderListItem } from '../../browser/components/providerListItem.js';
import { AuthMethod } from '../../browser/types.js';
import { IPositronLanguageModelSource, LanguageModelAutoconfigureType, PositronLanguageModelType } from '../../common/interfaces/positronAssistantService.js';

function source(overrides: Partial<IPositronLanguageModelSource> & { id: string }): IPositronLanguageModelSource {
	const { id, ...rest } = overrides;
	return {
		type: PositronLanguageModelType.Chat,
		provider: { id, displayName: id, settingName: id },
		supportedOptions: [],
		defaults: {},
		...rest,
	} as IPositronLanguageModelSource;
}

describe('ProviderListItem', () => {
	it('renders the display name and a maturity badge', () => {
		render(<ProviderListItem section='model-providers' selected={false} source={source({ id: 'a', provider: { id: 'a', displayName: 'Anthropic', settingName: 'a', status: 'preview' } })} onSelect={() => { }} />);
		expect(screen.getByText('Anthropic')).toBeInTheDocument();
		expect(screen.getByText('Preview')).toBeInTheDocument();
	});

	it('shows a description and a Connect action in the model-providers section', () => {
		render(<ProviderListItem description='Access Claude models' section='model-providers' selected={false} source={source({ id: 'a' })} onSelect={() => { }} />);
		expect(screen.getByText('Access Claude models')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
	});

	it('shows an Environment badge and Edit action for an env-var connected provider', () => {
		render(<ProviderListItem section='connected' selected={false} source={source({
			id: 'a',
			signedIn: true,
			defaults: { autoconfigure: { type: LanguageModelAutoconfigureType.EnvVariable, key: 'FOO_API_KEY', signedIn: true } },
		})} onSelect={() => { }} />);
		expect(screen.getByText('Environment')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
	});

	it('shows an OAuth badge for an oauth connected provider', () => {
		render(<ProviderListItem section='connected' selected={false} source={source({ id: 'a', signedIn: true, supportedOptions: [AuthMethod.OAUTH] })} onSelect={() => { }} />);
		expect(screen.getByText('OAuth')).toBeInTheDocument();
	});

	it('shows an Error badge, the error message, and a Fix Connection action in needs-attention', () => {
		render(<ProviderListItem section='needs-attention' selected={false} source={source({ id: 'a', signedIn: true, status: 'error', statusMessage: 'Session expired' })} onSelect={() => { }} />);
		expect(screen.getByText('Error')).toBeInTheDocument();
		expect(screen.getByText('Session expired')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Fix Connection' })).toBeInTheDocument();
	});

	it('calls onSelect when the row is clicked', async () => {
		const user = userEvent.setup();
		const onSelect = vi.fn();
		render(<ProviderListItem section='model-providers' selected={false} source={source({ id: 'a', provider: { id: 'a', displayName: 'Alpha', settingName: 'a' } })} onSelect={onSelect} />);
		// The row exposes its display name as an aria-label so it is queryable separately from its action button.
		await user.click(screen.getByRole('button', { name: 'Alpha' }));
		expect(onSelect).toHaveBeenCalled();
	});

	it('marks the row selected', () => {
		render(<ProviderListItem section='model-providers' selected={true} source={source({ id: 'a', provider: { id: 'a', displayName: 'Alpha', settingName: 'a' } })} onSelect={() => { }} />);
		expect(screen.getByRole('button', { name: 'Alpha' })).toHaveClass('selected');
	});
});
