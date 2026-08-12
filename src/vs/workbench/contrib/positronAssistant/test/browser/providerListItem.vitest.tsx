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
	const result: IPositronLanguageModelSource = {
		type: PositronLanguageModelType.Chat,
		provider: { id, displayName: id },
		supportedOptions: [],
		defaults: {},
		...rest,
	};
	return result;
}

describe('ProviderListItem', () => {
	it('renders the display name and a maturity badge', () => {
		render(<ProviderListItem section='model-providers' source={source({ id: 'a', provider: { id: 'a', displayName: 'Anthropic', status: 'preview' } })} />);
		expect(screen.getByText('Anthropic')).toBeInTheDocument();
		expect(screen.getByText('Preview')).toBeInTheDocument();
	});

	it('shows an Experimental badge for an experimental provider', () => {
		render(<ProviderListItem section='model-providers' source={source({ id: 'databricks', provider: { id: 'databricks', displayName: 'Databricks', status: 'experimental' } })} />);
		expect(screen.getByText('Databricks')).toBeInTheDocument();
		expect(screen.getByText('Experimental')).toBeInTheDocument();
	});

	it('shows a PWB Managed badge for a managed-credentials connected provider', () => {
		render(<ProviderListItem section='connected' source={source({
			id: 'databricks',
			signedIn: true,
			defaults: {
				autoconfigure: {
					type: LanguageModelAutoconfigureType.Custom,
					message: 'OAuth (Workbench Managed Credentials)',
					signedIn: true,
					isPositWorkbench: true,
				},
			},
		})} />);
		expect(screen.getByText('PWB Managed')).toBeInTheDocument();
	});

	it('shows an OAuth badge, not PWB Managed, for a connected copilot-auth provider', () => {
		render(<ProviderListItem section='connected' source={source({
			id: 'copilot-auth',
			signedIn: true,
			supportedOptions: [AuthMethod.OAUTH],
			defaults: { autoconfigure: { type: LanguageModelAutoconfigureType.Custom, message: 'the Accounts menu.', signedIn: true } },
		})} />);
		expect(screen.getByText('OAuth')).toBeInTheDocument();
		expect(screen.queryByText('PWB Managed')).not.toBeInTheDocument();
	});

	it('does not show PWB Managed for a Custom autoconfigure without isPositWorkbench', () => {
		render(<ProviderListItem section='connected' source={source({
			id: 'a',
			signedIn: true,
			defaults: { autoconfigure: { type: LanguageModelAutoconfigureType.Custom, message: 'Some other reason', signedIn: true } },
		})} />);
		expect(screen.queryByText('PWB Managed')).not.toBeInTheDocument();
	});

	it('shows a description and a Connect action in the model-providers section', () => {
		render(<ProviderListItem description='Access Claude models' section='model-providers' source={source({ id: 'a' })} />);
		expect(screen.getByText('Access Claude models')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
	});

	it('shows an Environment badge and Edit action for an env-var connected provider', () => {
		render(<ProviderListItem section='connected' source={source({
			id: 'a',
			signedIn: true,
			defaults: { autoconfigure: { type: LanguageModelAutoconfigureType.EnvVariable, key: 'FOO_API_KEY', signedIn: true } },
		})} />);
		expect(screen.getByText('Environment')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
	});

	it('shows an OAuth badge for an oauth connected provider', () => {
		render(<ProviderListItem section='connected' source={source({ id: 'a', signedIn: true, supportedOptions: [AuthMethod.OAUTH] })} />);
		expect(screen.getByText('OAuth')).toBeInTheDocument();
	});

	it('shows an Error badge, the error message, and a Fix Connection action in needs-attention', () => {
		render(<ProviderListItem section='needs-attention' source={source({ id: 'a', signedIn: true, status: 'error', statusMessage: 'Session expired' })} />);
		expect(screen.getByText('Error')).toBeInTheDocument();
		expect(screen.getByText('Session expired')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Fix Connection' })).toBeInTheDocument();
	});

	it('calls onAction when the action button is clicked', async () => {
		const user = userEvent.setup();
		const onAction = vi.fn();
		render(<ProviderListItem section='model-providers' source={source({ id: 'a' })} onAction={onAction} />);
		await user.click(screen.getByRole('button', { name: 'Connect' }));
		expect(onAction).toHaveBeenCalledTimes(1);
	});
});
