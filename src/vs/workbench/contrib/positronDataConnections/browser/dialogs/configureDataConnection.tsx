/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './configureDataConnection.css';

// React.
import { useCallback, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { DataConnectionActionBar } from './dataConnectionActionBar.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { Checkbox } from '../../../../browser/positronComponents/positronModalDialog/components/checkbox.js';
import { ContentArea } from '../../../../browser/positronComponents/positronModalDialog/components/contentArea.js';
import { PositronModalDialog } from '../../../../browser/positronComponents/positronModalDialog/positronModalDialog.js';
import { IDataConnectionDriver, IDataConnectionProfile } from '../../../../services/positronDataConnections/common/interfaces/positronDataConnectionsDriver.js';

/**
 * UI-side form state for a single parameter value, pairing the value with an error indicator.
 */
interface ParameterValueState {
	value: string | number | boolean | undefined;
	error: boolean;
}

/**
 * UI-side form state for all parameter values.
 */
export type ParameterValues = Record<string, ParameterValueState>;

/**
 * ConfigureDataConnectionProps interface.
 */
interface ConfigureDataConnectionProps {
	// The renderer.
	renderer: PositronModalReactRenderer;

	// The driver for the connection being configured.
	driver: IDataConnectionDriver;

	// The data connection profile being configured.
	profile: IDataConnectionProfile;

	// Called when the user clicks Back to return to the previous step. If not provided, the Back
	// button will not be shown.
	onBack?: () => void;

	// Called when the user clicks Create to create the data connection. If not provided, the Create
	onAccept?: (profile: IDataConnectionProfile) => void;
}

/**
 * ConfigureDataConnection component.
 * Displays a dialog with the connection configuration form for the selected driver.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const ConfigureDataConnection = (props: ConfigureDataConnectionProps) => {
	// Destructure props for use in hooks.
	const { renderer, onBack } = props;

	// Destructure the driver from props for convenience.
	const { driver } = props;

	// State.
	const [connectionName, setConnectionName] = useState(props.profile.connectionName);
	const [connectionNameError, setConnectionNameError] = useState(false);
	const [parameterValues, setParameterValues] = useState<ParameterValues>(() => {
		// Initialize all driver parameters from the profile's existing values, falling back to driver defaults.
		const initialParameterValues: ParameterValues = {};
		for (const parameter of driver.metadata.parameters) {
			initialParameterValues[parameter.id] = {
				value: props.profile.parameterValues[parameter.id] ?? parameter.defaultValue ?? undefined,
				error: false
			};
		}

		// Return the initial parameter values.
		return initialParameterValues;
	});

	// Updates a single parameter value and clears its error.
	const setParameterValue = useCallback((parameterId: string, value: string | number | boolean | undefined) => {
		setParameterValues(prev => ({
			...prev,
			[parameterId]: {
				// Set the value, ensuring that an empty string is treated as undefined.
				value: value === '' ? undefined : value,

				// Clear the error for this parameter when the value changes. We validate on accept.
				error: false
			}
		}));
	}, []);

	// Cancel handler.
	const cancelHandler = useCallback(() => {
		// Dispose the renderer, which will close the dialog.
		renderer.dispose();
	}, [renderer]);

	// Accept handler.
	const acceptHandler = useCallback(() => {
		// Validate the connection name. It is required and must not be empty.
		if (!connectionName.length) {
			setConnectionNameError(true);
		}

		// Validate the parameters. Required parameters must not be empty.
		const newParameterValues = { ...parameterValues };
		let hasParameterErrors = false;
		for (const parameter of driver.metadata.parameters) {
			const hasError = parameter.required === true && parameterValues[parameter.id].value === undefined;
			console.log('Validating parameter', parameter.id, 'value', parameterValues[parameter.id].value, 'hasError', hasError);
			newParameterValues[parameter.id] = {
				value: parameterValues[parameter.id].value,
				error: hasError
			};
			hasParameterErrors = hasParameterErrors || hasError;
		}

		// Set the new parameter values with any error indicators.
		setParameterValues(newParameterValues);

		// TODO: Save the connection.
		// renderer.dispose();
	}, [connectionName.length, driver.metadata.parameters, parameterValues]);

	// Render.
	return (
		<PositronModalDialog
			height={520}
			renderer={props.renderer}
			title={localize(
				'positron.configureDataConnection.title',
				"Configure Data Connection"
			)}
			width={600}
			onCancel={cancelHandler}
		>
			<ContentArea>
				<div className='configure-data-connection'>
					{/* Driver Header. */}
					<div className='driver-header'>
						<div className='driver-header-badge'>
							<img alt='' className='driver-header-icon' src={`data:image/svg+xml;base64,${driver.metadata.iconSvg}`} />
						</div>
						<div className='driver-header-name'>{driver.metadata.name}</div>
					</div>

					{/* Connection Name */}
					<div className='parameter-field'>
						<label className='parameter-label'>Connection Name</label>
						<input
							className={positronClassNames(
								'parameter-input', 'text-input',
								{ 'error': connectionNameError }
							)}
							placeholder='connection name'
							type='text'
							value={connectionName}
							onChange={e => {
								setConnectionName(e.target.value.trim());
								setConnectionNameError(false);
							}}
						/>
					</div>

					{/* Parameters */}
					{driver.metadata.parameters.map(parameter => {
						switch (parameter.type) {
							// String parameter.
							case 'string':
								return (
									<div key={parameter.id} className='parameter-field'>
										<label className='parameter-label'>{parameter.label}</label>
										<input
											className={positronClassNames(
												'parameter-input', 'text-input',
												{ 'error': parameterValues[parameter.id].error }
											)}
											placeholder={parameter.placeholder}
											type='text'
											value={parameterValues[parameter.id].value as string}
											onChange={e => setParameterValue(parameter.id, e.target.value.trim() ?? undefined)}
										/>
									</div>
								);

							// Number parameter.
							case 'number':
								return (
									<div key={parameter.id} className='parameter-field'>
										<label className='parameter-label'>{parameter.label}</label>
										<input
											className={positronClassNames(
												'parameter-input', 'text-input',
												{ 'error': parameterValues[parameter.id].error }
											)}
											inputMode='numeric'
											placeholder={parameter.placeholder}
											type='text'
											value={String(parameterValues[parameter.id].value ?? '')}
											onChange={e => {
												// Get the new value, trimming whitespace.
												const newValue = e.target.value.trim();

												// Parse the value as a number. Number('') === 0, so handle empty string first.
												const numericValue = newValue !== '' ? Number(newValue) : NaN;
												setParameterValue(parameter.id, isNaN(numericValue) ? undefined : numericValue);
											}}
										/>
									</div>
								);

							// Boolean parameter.
							case 'boolean':
								return (
									<div key={parameter.id}>
										<Checkbox
											initialChecked={parameterValues[parameter.id].value as boolean}
											label={parameter.label}
											onChanged={checked => setParameterValue(parameter.id, checked)}
										/>
									</div>
								);

							// File parameter.
							case 'file':
								return (
									<div key={parameter.id} className='parameter-field'>
										<label className='parameter-label'>{parameter.label}</label>
										<input
											className={positronClassNames(
												'parameter-input', 'text-input',
												{ 'error': parameterValues[parameter.id].error }
											)}
											placeholder={parameter.placeholder}
											type='text'
											value={parameterValues[parameter.id].value as string}
											onChange={e => setParameterValue(parameter.id, e.target.value.trim())}
										/>
									</div>
								);

							// Option parameter.
							case 'option':
								return (
									<div key={parameter.id} className='parameter-field'>
										<label className='parameter-label'>{parameter.label}</label>
										<select
											className={positronClassNames(
												'parameter-input', 'parameter-select',
												{ 'error': parameterValues[parameter.id].error }
											)}
											value={parameterValues[parameter.id].value as string}
											onChange={e => {
												setParameterValue(parameter.id, e.target.value);
											}}
										>
											{parameter.options?.map(option => (
												<option key={option} value={option}>{option}</option>
											))}
										</select>
									</div>
								);

							// Unsupported parameter type.
							default:
								console.warn(`Unsupported parameter type '${parameter.type}' for parameter '${parameter.id}' in driver '${driver.id}'.`);
								return null;
						}
					})}

				</div>
			</ContentArea>
			<DataConnectionActionBar
				acceptLabel={localize('positron.configureDataConnection.save', "Save")}
				onAccept={acceptHandler}
				onBack={onBack}
				onCancel={cancelHandler}
			/>
		</PositronModalDialog>
	);
};
