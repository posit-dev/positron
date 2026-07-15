/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Event } from '../../../../../base/common/event.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { ProviderList } from '../../browser/components/providerList.js';
import { IPositronAssistantConfigurationService, IPositronLanguageModelSource, PositronLanguageModelType } from '../../common/interfaces/positronAssistantService.js';
import { IAuthenticationService } from '../../../../services/authentication/common/authentication.js';

function source(overrides: Partial<IPositronLanguageModelSource> & { id: string; displayName?: string }): IPositronLanguageModelSource {
	const { id, displayName, ...rest } = overrides;
	return {
		type: PositronLanguageModelType.Chat,
		provider: { id, displayName: displayName ?? id, settingName: id },
		supportedOptions: [],
		defaults: {},
		...rest,
	} as IPositronLanguageModelSource;
}

describe('ProviderList', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IPositronAssistantConfigurationService, { onChangeProviderConfig: Event.None })
		.stub(IAuthenticationService, { onDidChangeSessions: Event.None })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	it('renders a heading per non-empty section', () => {
		rtl.render(<ProviderList sources={[
			source({ id: 'conn', displayName: 'Connected One', signedIn: true, status: 'ok', statusMessage: 'Signed in via GitHub' }),
			source({ id: 'avail', displayName: 'Available One', signedIn: false }),
		]} />);
		expect(screen.getByText('Connected')).toBeInTheDocument();
		expect(screen.getByText('Available Providers')).toBeInTheDocument();
	});

	it('does not render empty section headings', () => {
		rtl.render(<ProviderList sources={[source({ id: 'avail', signedIn: false })]} />);
		expect(screen.queryByText('Connected')).not.toBeInTheDocument();
		expect(screen.queryByText('Providers needing attention')).not.toBeInTheDocument();
	});

	it('selects a row on click', async () => {
		const user = userEvent.setup();
		rtl.render(<ProviderList sources={[source({ id: 'a', displayName: 'Alpha', signedIn: false })]} />);
		const row = screen.getByRole('button', { name: /Alpha/ });
		await user.click(row);
		expect(row).toHaveClass('selected');
	});

	it('preselects the provider from options', () => {
		rtl.render(<ProviderList options={{ preselectedProviderId: 'a' }} sources={[
			source({ id: 'a', displayName: 'Alpha', signedIn: false }),
			source({ id: 'b', displayName: 'Bravo', signedIn: false }),
		]} />);
		expect(screen.getByRole('button', { name: /Alpha/ })).toHaveClass('selected');
	});
});
