/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { userEvent } from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import { ProviderListItem } from '../../browser/components/providerListItem.js';
import { IPositronLanguageModelSource, PositronLanguageModelType } from '../../common/interfaces/positronAssistantService.js';

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
	it('renders the display name and a maturity label', () => {
		render(<ProviderListItem selected={false} showStatus={true} source={source({ id: 'a', provider: { id: 'a', displayName: 'Anthropic', settingName: 'a', status: 'preview' } })} onSelect={() => { }} />);
		expect(screen.getByText('Anthropic')).toBeInTheDocument();
		expect(screen.getByText('Preview')).toBeInTheDocument();
	});

	it('shows the status message when present and showStatus is true', () => {
		render(<ProviderListItem selected={false} showStatus={true} source={source({ id: 'a', signedIn: true, status: 'ok', statusMessage: 'Signed in via GitHub' })} onSelect={() => { }} />);
		expect(screen.getByText('Signed in via GitHub')).toBeInTheDocument();
	});

	it('hides the status line when showStatus is false', () => {
		render(<ProviderListItem selected={false} showStatus={false} source={source({ id: 'a', signedIn: true, status: 'error', statusMessage: 'Session expired' })} onSelect={() => { }} />);
		expect(screen.queryByText('Session expired')).not.toBeInTheDocument();
	});

	it('calls onSelect when clicked', async () => {
		const user = userEvent.setup();
		const onSelect = vi.fn();
		render(<ProviderListItem selected={false} showStatus={true} source={source({ id: 'a' })} onSelect={onSelect} />);
		await user.click(screen.getByRole('button'));
		expect(onSelect).toHaveBeenCalledTimes(1);
	});

	it('marks the row selected', () => {
		render(<ProviderListItem selected={true} showStatus={true} source={source({ id: 'a' })} onSelect={() => { }} />);
		expect(screen.getByRole('button')).toHaveClass('selected');
	});
});
