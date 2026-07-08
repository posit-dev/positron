/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />
/// <reference types="@testing-library/jest-dom/vitest" />

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigureDataConnectionParameters } from '../../browser/dialogs/configureDataConnectionParameters.js';
import { IDataConnectionParameter } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';
import type { ParameterFieldStates } from '../../browser/dialogs/configureDataConnection.js';

describe('ConfigureDataConnectionParameters', () => {
	const fileParameter: IDataConnectionParameter = {
		id: 'databasePath',
		label: 'Database File',
		type: 'file',
		required: true,
	};
	const stringParameter: IDataConnectionParameter = {
		id: 'host',
		label: 'Host',
		type: 'string',
	};

	// Renders the component with default field states and returns the callback spies.
	const renderParameters = (parameters: IDataConnectionParameter[]) => {
		const parameterFieldStates: ParameterFieldStates = Object.fromEntries(
			parameters.map(parameter => [parameter.id, { value: '', error: false }])
		);
		const onBrowseFile = vi.fn();
		const onParameterChanged = vi.fn();
		render(
			<ConfigureDataConnectionParameters
				parameterFieldStates={parameterFieldStates}
				parameters={parameters}
				storedSecretIds={new Set()}
				onBrowseFile={onBrowseFile}
				onParameterChanged={onParameterChanged}
			/>
		);
		return { onBrowseFile, onParameterChanged };
	};

	it('renders a Browse button for a file parameter and invokes onBrowseFile when clicked', async () => {
		const user = userEvent.setup();
		const { onBrowseFile } = renderParameters([fileParameter]);

		await user.click(screen.getByRole('button', { name: 'Browse...' }));

		expect(onBrowseFile).toHaveBeenCalledWith('databasePath');
	});

	it('does not render a Browse button for non-file parameters', () => {
		renderParameters([stringParameter]);

		expect(screen.queryByRole('button', { name: 'Browse...' })).not.toBeInTheDocument();
	});
});
