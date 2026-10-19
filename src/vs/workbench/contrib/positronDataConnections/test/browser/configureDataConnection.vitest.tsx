/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen, waitFor } from '@testing-library/react';
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
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { IDataConnectionDriver, IDataConnectionMechanism, IDataConnectionParameterValidation } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';
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
	const renderer = stubInterface<PositronModalReactRenderer>({ onKeyDown: Event.None, onResize: Event.None });

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

	it('marks an empty Connection Name invalid on Save and clears it once a name is typed', async () => {
		const user = userEvent.setup();
		const onSave = vi.fn();
		rtl.render(
			<ConfigureDataConnection
				driver={driver}
				mechanism={mechanismWithFileParameter('/existing/data.duckdb')}
				renderer={renderer}
				onSave={onSave}
			/>
		);
		const connectionName = screen.getByLabelText('Connection Name');
		expect(connectionName).toBeValid();

		await user.click(screen.getByRole('button', { name: 'Save' }));
		expect(connectionName).toBeInvalid();
		expect(onSave).not.toHaveBeenCalled();

		await user.type(connectionName, 'My Connection');
		expect(connectionName).toBeValid();
	});

	describe('validation on Save', () => {
		// A driver whose validateParameters the test controls.
		const validateParameters = vi.fn<IDataConnectionDriver['validateParameters']>();
		const validatingDriver = stubInterface<IDataConnectionDriver>({
			id: 'duckdb',
			metadata: driver.metadata,
			validateParameters,
		});

		// Renders the dialog for a profile-less file mechanism with a name already entered, so a click
		// on Save goes straight to the driver's validation.
		const renderValidatingDialog = async (onSave = vi.fn()) => {
			const user = userEvent.setup();
			const result = rtl.render(
				<ConfigureDataConnection
					driver={validatingDriver}
					mechanism={mechanismWithFileParameter('data.duckdb')}
					renderer={renderer}
					onSave={onSave}
				/>
			);
			await user.type(screen.getByLabelText('Connection Name'), 'My Connection');
			return { user, onSave, unmount: result.unmount };
		};

		// A validation result the test resolves when it chooses, to act while the driver is working.
		const pendingValidation = () => {
			let resolve!: (validation: IDataConnectionParameterValidation) => void;
			validateParameters.mockReturnValueOnce(new Promise(r => { resolve = r; }));
			return { resolve: (validation: IDataConnectionParameterValidation) => act(async () => resolve(validation)) };
		};

		it('shows the driver errors beneath their fields, does not save, and clears an error once its field is edited', async () => {
			validateParameters.mockResolvedValueOnce({ errors: { databasePath: '"/ws/data.duckdb" does not exist.' } });
			const { user, onSave } = await renderValidatingDialog();

			await user.click(screen.getByRole('button', { name: 'Save' }));

			expect(await screen.findByRole('alert')).toHaveTextContent('"/ws/data.duckdb" does not exist.');
			expect(onSave).not.toHaveBeenCalled();

			await user.type(screen.getByLabelText('Database File'), 'x');
			expect(screen.queryByRole('alert')).not.toBeInTheDocument();
		});

		it('saves the values the driver normalized, for the mechanism parameters only', async () => {
			validateParameters.mockResolvedValueOnce({ normalizedValues: { databasePath: '/ws/data.duckdb', unknown: 'ignored' } });
			const { user, onSave } = await renderValidatingDialog();

			await user.click(screen.getByRole('button', { name: 'Save' }));

			await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
				connectionName: 'My Connection',
				parameterValues: { databasePath: '/ws/data.duckdb' },
			})));
			expect(validateParameters).toHaveBeenCalledWith('file', { databasePath: 'data.duckdb' });
		});

		it('saves the values as entered when the driver fails to validate them', async () => {
			validateParameters.mockRejectedValueOnce(new Error('extension host went away'));
			const { user, onSave } = await renderValidatingDialog();

			await user.click(screen.getByRole('button', { name: 'Save' }));

			await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
				parameterValues: { databasePath: 'data.duckdb' },
			})));
		});

		it('does not save when the dialog closes while the driver is validating', async () => {
			const validation = pendingValidation();
			const { user, onSave, unmount } = await renderValidatingDialog();

			await user.click(screen.getByRole('button', { name: 'Save' }));
			unmount();
			await validation.resolve({ normalizedValues: { databasePath: '/ws/data.duckdb' } });

			expect(onSave).not.toHaveBeenCalled();
		});

		it('does not save values the user changed while the driver was validating them', async () => {
			const validation = pendingValidation();
			const { user, onSave } = await renderValidatingDialog();

			await user.click(screen.getByRole('button', { name: 'Save' }));
			await user.type(screen.getByLabelText('Database File'), '2');
			await validation.resolve({ errors: { databasePath: 'stale error' } });

			expect(screen.queryByRole('alert')).not.toBeInTheDocument();
			expect(onSave).not.toHaveBeenCalled();

			// The next Save validates the current values.
			validateParameters.mockResolvedValueOnce({});
			await user.click(screen.getByRole('button', { name: 'Save' }));
			await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
				parameterValues: { databasePath: 'data.duckdb2' },
			})));
		});

		it('ignores a second Save while the driver is validating', async () => {
			const validation = pendingValidation();
			const { user, onSave } = await renderValidatingDialog();

			await user.click(screen.getByRole('button', { name: 'Save' }));
			await user.click(screen.getByRole('button', { name: 'Save' }));
			await validation.resolve({});

			expect(validateParameters).toHaveBeenCalledTimes(1);
			expect(onSave).toHaveBeenCalledTimes(1);
		});
	});
});
