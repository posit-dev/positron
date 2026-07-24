/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { IPositronLanguageModelSource, PositronLanguageModelType } from '../../common/interfaces/positronAssistantService.js';
import { NotYetSupportedView } from '../../browser/components/notYetSupportedView.js';

const bedrock: IPositronLanguageModelSource = {
	type: PositronLanguageModelType.Chat,
	provider: { id: 'amazon-bedrock', displayName: 'AWS Bedrock', settingName: 'amazonBedrock' },
	supportedOptions: ['toolCalls'],
	signedIn: false,
	defaults: {},
};

describe('NotYetSupportedView', () => {
	const ctx = createTestContainer().withReactServices().build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	it('names the provider when given a source', () => {
		rtl.render(<NotYetSupportedView source={bedrock} />);
		expect(screen.getByText(/AWS Bedrock.*not supported yet/i)).toBeInTheDocument();
	});

	it('shows a generic message for the custom-provider flow (no source)', () => {
		rtl.render(<NotYetSupportedView />);
		expect(screen.getByText(/this provider.*not supported yet/i)).toBeInTheDocument();
	});
});
