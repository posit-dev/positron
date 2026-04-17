/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './configureDataConnection.css';

// React.
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { PositronModalDialogReactRenderer } from '../../../../../base/browser/positronModalDialogReactRenderer.js';
import { Checkbox } from '../../../../browser/positronComponents/positronDynamicModalDialog/components/checkbox.js';
import { TwoButtonFooter } from '../../../../browser/positronComponents/positronDynamicModalDialog/components/twoButtonFooter.js';
import { PositronDynamicModalDialog } from '../../../../browser/positronComponents/positronDynamicModalDialog/positronDynamicModalDialog.js';
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
	renderer: PositronModalDialogReactRenderer;

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
	// Ref to the Connection Name input so we can drive initial focus to it (overriding the
	// primary button's autoFocus, which fires during React commit before this effect runs).
	const connectionNameInputRef = useRef<HTMLInputElement>(null);

	// Focus the Connection Name input when the dialog mounts.
	useEffect(() => {
		connectionNameInputRef.current?.focus();
	}, []);

	// State.
	const [connectionName, setConnectionName] = useState(props.profile.connectionName);
	const [connectionNameError, setConnectionNameError] = useState(false);
	const [parameterValues, setParameterValues] = useState<ParameterValues>(() => {
		// Initialize all driver parameters from the profile's existing values, falling back to driver defaults.
		const initialParameterValues: ParameterValues = {};
		for (const parameter of props.driver.metadata.parameters) {
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
		props.renderer.dispose();
	}, [props.renderer]);

	// Accept handler.
	const acceptHandler = useCallback(() => {
		// Validate the connection name. It is required and must not be empty.
		if (!connectionName.length) {
			setConnectionNameError(true);
		}

		// Validate the parameters. Required parameters must not be empty.
		const newParameterValues = { ...parameterValues };
		let hasParameterErrors = false;
		for (const parameter of props.driver.metadata.parameters) {
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
	}, [connectionName.length, props.driver.metadata.parameters, parameterValues]);

	// Handler that runs when the user submits the form (e.g. by pressing Enter in a text field).
	const submitHandler = (event: FormEvent) => {
		// Prevent default form action
		event.preventDefault();

		// Run the accept handler.
		acceptHandler();
	};

	// Render.
	return (
		<PositronDynamicModalDialog
			content={
				<form onSubmit={submitHandler}>
					<div className='configure-data-connection-container'>
						<div className='configure-data-connection'>
							{/* Driver Header. */}
							<div className='driver-header'>
								<div className='driver-header-badge'>
									<img alt='' className='driver-header-icon' src={`data:image/svg+xml;base64,${props.driver.metadata.iconSvg}`} />
								</div>
								<div className='driver-header-name'>{props.driver.metadata.name}</div>
							</div>

							{/* Connection Name */}
							<div className='parameter-field'>
								<label className='parameter-label'>Connection Name</label>
								<input
									ref={connectionNameInputRef}
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
							{props.driver.metadata.parameters.map(parameter => {
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
										console.warn(`Unsupported parameter type '${parameter.type}' for parameter '${parameter.id}' in driver '${props.driver.id}'.`);
										return null;
								}
							})}

						</div>
					</div>
					{/* Hidden submit button to allow form submission via Enter key. */}
					<button hidden type='submit' />
				</form>
			}
			footer={
				<TwoButtonFooter
					primaryButtonTitle={localize('positron.configureDataConnection.save', "Save")}
					secondaryButtonTitle={localize('positron.configureDataConnection.cancel', "Cancel")}
					onPrimaryButton={acceptHandler}
					onSecondaryButton={cancelHandler}
				/>
			}
			renderer={props.renderer}
			title={localize(
				'positron.configureDataConnection.title',
				"Configure Data Connection"
			)}
			width={600}
			onCancel={cancelHandler}
		/>
	);
};
