/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { IDisposable } from '../../../../../base/common/lifecycle.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { IDataConnectionInstance } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionInstance.js';
import { IDataConnectionProfile } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';
import { DataConnectionEntryRow } from '../../browser/components/dataConnectionEntryRow.js';

const profile: IDataConnectionProfile = {
	id: 'conn-1',
	driverMetadata: {
		id: 'test-driver',
		name: 'Test Driver',
		iconSvg: '',
		supportedLanguageIds: [],
	},
	connectionName: 'My Connection',
	mechanismId: 'test-mechanism',
	parameterValues: {},
};

describe('DataConnectionEntryRow', () => {
	const ctx = createTestContainer().withReactServices().build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	// The tree supplies these; neither is exercised here, where the indicator is what's under test.
	const onRefresh = vi.fn();
	const onMenuOpening = vi.fn((): IDisposable => ({ dispose: vi.fn() }));

	it('shows the connected indicator for a profile with a live connection', () => {
		const instance = stubInterface<IDataConnectionInstance>({ id: 'instance-1', profileId: profile.id });

		rtl.render(<DataConnectionEntryRow entry={{ profile, instance }} onMenuOpening={onMenuOpening} onRefresh={onRefresh} />);

		// The indicator is a bare dot, so its accessible name is the only thing to query it by.
		expect(screen.getByRole('img', { name: 'Connected' })).toBeInTheDocument();
	});

	it('shows no connected indicator for a saved profile that is not connected', () => {
		rtl.render(<DataConnectionEntryRow entry={{ profile }} onMenuOpening={onMenuOpening} onRefresh={onRefresh} />);

		expect(screen.queryByRole('img', { name: 'Connected' })).not.toBeInTheDocument();
		expect(screen.getByText('My Connection', { exact: false })).toBeInTheDocument();
	});
});
