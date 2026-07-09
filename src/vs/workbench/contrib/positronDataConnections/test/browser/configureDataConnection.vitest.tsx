/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { URI } from '../../../../../base/common/uri.js';
import { Event } from '../../../../../base/common/event.js';
import { posix } from '../../../../../base/common/path.js';
import { ILabelService } from '../../../../../platform/label/common/label.js';
import { IFileDialogService, IOpenDialogOptions } from '../../../../../platform/dialogs/common/dialogs.js';
import { IPathService } from '../../../../services/path/common/pathService.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { PositronModalDialogReactRenderer } from '../../../../../base/browser/positronModalDialogReactRenderer.js';
import { IDataConnectionDriver, IDataConnectionMechanism } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';
import { ConfigureDataConnection } from '../../browser/dialogs/configureDataConnection.js';

describe('ConfigureDataConnection', () => {
	// File dialog seams under test. The implementations persist across tests (clearMocks only
	// clears call history); showOpenDialog resolves undefined (= user cancelled) unless a test
	// queues a selection with mockResolvedValueOnce.
	const defaultFilePath = vi.fn(async (_schemeFilter?: string) => URI.file('/home/user'));
	const showOpenDialog = vi.fn(async (_options: IOpenDialogOptions): Promise<URI[] | undefined> => undefined);

	const ctx = createTestContainer()
		.withReactServices()
		.stub(IFileDialogService, { defaultFilePath, showOpenDialog })
		// Format chosen URIs back to a plain path so the write-back is assertable.
		.stub(ILabelService, { getUriLabel: (uri: URI) => uri.path })
		// The browse handler re-homes a typed path via the server platform's path lib.
		.stub(IPathService, { path: Promise.resolve(posix) })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	// The dialog only subscribes to the renderer's resize event during render.
	const renderer = stubInterface<PositronModalDialogReactRenderer>({ onResize: Event.None });

	const driver = stubInterface<IDataConnectionDriver>({
		id: 'duckdb',
		metadata: {
			id: 'duckdb',
			name: 'DuckDB',
			description: 'Connect to DuckDB databases',
			iconSvg: '',
			mechanisms: [],
			supportedLanguageIds: ['python'],
		},
	});

	// Builds a mechanism with a single file parameter carrying a driver-declared filter,
	// optionally pre-filled with a current value.
	const mechanismWithFileParameter = (defaultValue?: string): IDataConnectionMechanism => ({
		id: 'file',
		label: 'Database File',
		description: 'Connect to a database file',
		parameters: [{
			id: 'databasePath',
			label: 'Database File',
			type: 'file',
			required: true,
			defaultValue,
			filters: [{ name: 'DuckDB Files', extensions: ['duckdb', 'ddb'] }],
		}],
	});

	const renderDialog = (mechanism: IDataConnectionMechanism) => {
		rtl.render(
			<ConfigureDataConnection
				driver={driver}
				mechanism={mechanism}
				renderer={renderer}
				onSave={() => { }}
			/>
		);
	};

	it('opens the picker with the driver filters plus All Files and writes the chosen path into the field', async () => {
		const user = userEvent.setup();
		showOpenDialog.mockResolvedValueOnce([URI.file('/data/chosen.duckdb')]);
		renderDialog(mechanismWithFileParameter());
		const input = screen.getByLabelText('Database File');

		await user.click(screen.getByRole('button', { name: 'Browse...' }));

		await waitFor(() => expect(input).toHaveValue('/data/chosen.duckdb'));
		expect(showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({
			// The field is empty, so the picker starts at the default file path.
			defaultUri: expect.objectContaining({ path: '/home/user' }),
			filters: [
				{ name: 'DuckDB Files', extensions: ['duckdb', 'ddb'] },
				{ name: 'All Files', extensions: ['*'] },
			],
			// Restricted to the extension host's file system (the default file path's scheme) so
			// the web/remote picker never offers browser-local files the driver cannot open.
			availableFileSystems: ['file'],
		}));
	});

	it('seeds the picker starting location from the field current value', async () => {
		const user = userEvent.setup();
		renderDialog(mechanismWithFileParameter('/existing/data.duckdb'));

		await user.click(screen.getByRole('button', { name: 'Browse...' }));

		await waitFor(() => expect(showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({
			defaultUri: expect.objectContaining({ path: '/existing/data.duckdb' }),
		})));
	});

	it('leaves the field unchanged when the picker is cancelled', async () => {
		const user = userEvent.setup();
		renderDialog(mechanismWithFileParameter('/existing/data.duckdb'));

		await user.click(screen.getByRole('button', { name: 'Browse...' }));

		await waitFor(() => expect(showOpenDialog).toHaveBeenCalled());
		expect(screen.getByLabelText('Database File')).toHaveValue('/existing/data.duckdb');
	});
});
