/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { screen } from '@testing-library/react';
import { Event } from '../../../../../base/common/event.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { IDataConnectionDriver } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';
import { IDataConnectionsDriverManager } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionsDriverManager.js';
import { IPositronDataConnectionsService } from '../../../../services/positronDataConnections/common/interfaces/positronDataConnectionsService.js';
import { SelectDataConnectionProvider } from '../../browser/dialogs/selectDataConnectionProvider.js';

/** A registered driver with the given id and display name. */
function createDriver(id: string, name: string): IDataConnectionDriver {
	return stubInterface<IDataConnectionDriver>({
		id,
		metadata: { id, name, description: '', iconSvg: '', mechanisms: [], supportedLanguageIds: [] },
	});
}

describe('SelectDataConnectionProvider', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IPositronDataConnectionsService, {
			driverManager: stubInterface<IDataConnectionsDriverManager>({
				getDrivers: () => [
					createDriver('runtime-r', 'R Session'),
					createDriver('duckdb', 'DuckDB'),
					createDriver('runtime-python', 'Python Session'),
				],
				onDidChangeDrivers: Event.None,
			}),
		})
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	// The dialog only subscribes to the renderer's resize event during render.
	const renderer = stubInterface<PositronModalReactRenderer>({ onKeyDown: Event.None, onResize: Event.None });

	// The runtime drivers serve connections R and Python sessions opened; they cannot make new ones.
	it('lists no runtime drivers', () => {
		rtl.render(<SelectDataConnectionProvider renderer={renderer} onNext={vi.fn()} />);

		expect(screen.getByRole('button', { name: 'Connect to DuckDB' })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Connect to R Session' })).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Connect to Python Session' })).not.toBeInTheDocument();
	});
});
