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
import { Checkbox } from '../../../../../base/browser/ui/positronComponents/checkbox/checkbox.js';
import { TwoButtonFooter } from '../../../../browser/positronComponents/positronDynamicModalDialog/components/twoButtonFooter.js';
import { PositronDynamicModalDialog } from '../../../../browser/positronComponents/positronDynamicModalDialog/positronDynamicModalDialog.js';
import { DataConnectionParameterValues, IDataConnectionDriver, IDataConnectionProfile } from '../../../../services/positronDataConnections/common/interfaces/positronDataConnectionsDriver.js';

/**
 * UI-side form state for a single parameter field, pairing the value with an error indicator.
 */
interface ParameterFieldState {
	// The current value of the parameter. Undefined if no value is set; for required parameters
	// this indicates an error.
	value: boolean | number | string | undefined;

	// Whether the parameter currently has a validation error. For required parameters, this is
	// true when value is undefined.
	error: boolean;
}

/**
 * UI-side form state for all parameter fields.
 */
type ParameterFieldStates = Record<string, ParameterFieldState>;

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

	// Called when the user clicks the Back button to return to the previous step. If not provided, the Back
	// button will not be shown.
	onBack?: () => void;

	// Called when the user clicks Save to save the connection profile.
	onSave?: (dataConnectionProfile: IDataConnectionProfile) => void;
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
	const [parameterFieldStates, setParameterFieldStates] = useState<ParameterFieldStates>(() => {
		// Initialize parameter field states.
		const initialParameterFieldStates: ParameterFieldStates = {};
		for (const parameter of props.driver.metadata.parameters) {
			// Get the default value for the parameter. Password parameters and secret string
			// parameters do not have a default value in the type system.
			const defaultValue = parameter.type === 'password' || (parameter.type === 'string' && parameter.secret)
				? undefined
				: parameter.defaultValue;

			// Set the initial value for the parameter. Use the value from the profile if available;
			// otherwise fall back to the default value (if any). For required parameters, leaving
			// the value as undefined will trigger a validation error until the user provides a value.
			initialParameterFieldStates[parameter.id] = {
				value: props.profile.parameterValues[parameter.id] ?? defaultValue ?? undefined,
				error: false
			};
		}

		// Return the initial parameter field states.
		return initialParameterFieldStates;
	});

	// Updates a single parameter field state.
	const setParameterFieldState = useCallback((parameterId: string, value: boolean | number | string | undefined) => {
		// Update the parameter field state.
		setParameterFieldStates(prev => ({
			...prev,
			[parameterId]: {
				// Set the value, ensuring that an empty string is treated as undefined.
				value: value === '' ? undefined : value,

				// Clear the error for this parameter field state when the value changes. We validate on accept.
				error: false
			}
		}));
	}, []);

	// Cancel handler.
	const cancelHandler = useCallback(() => {
		// Dispose the renderer, which will close the dialog.
		props.renderer.dispose();
	}, [props.renderer]);

	// Save handler.
	const saveHandler = useCallback(() => {
		// A value which indicates whether any validation errors are present in the form. If true,
		// the form will not be submitted and error indicators will be shown.
		let hasErrors = false;

		// Validate the connection name. It is required and must not be empty.
		if (!connectionName.length) {
			hasErrors = true;
			setConnectionNameError(true);
		}

		// Validate the parameters. Required parameters must not be empty.
		const updatedParameterFieldStates = { ...parameterFieldStates };
		for (const parameter of props.driver.metadata.parameters) {
			// Get the current value for this parameter field.
			const value = parameterFieldStates[parameter.id].value;

			// Determine if there is a validation error for this parameter. For required parameters,
			// an error exists if the value is undefined.
			const hasError = parameter.required === true && value === undefined;

			// Update the parameter field state.
			updatedParameterFieldStates[parameter.id] = {
				value,
				error: hasError
			};

			// If there was an error or is an error, ensure that hasErrors is set to true to prevent
			// form submission.
			hasErrors = hasErrors || hasError;
		}

		// Set the new parameter field states.
		setParameterFieldStates(updatedParameterFieldStates);

		// If there are no errors, submit the form.
		if (!hasErrors) {
			// Build the parameter values.
			const parameterValues: DataConnectionParameterValues = {};
			for (const [id, { value }] of Object.entries(updatedParameterFieldStates)) {
				if (value !== undefined) {
					parameterValues[id] = value;
				}
			}

			// Call the onSave callback with the connection profile.
			props.onSave?.({
				...props.profile,
				connectionName,
				parameterValues
			});
		}
	}, [connectionName, parameterFieldStates, props]);

	// Handler that runs when the user submits the form (e.g. by pressing Enter in a text field).
	const submitHandler = (event: FormEvent) => {
		// Prevent default form action
		event.preventDefault();

		// Run the accept handler.
		saveHandler();
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
								<label className='parameter-label'>{localize('positron.connectionName', 'Connection Name')}</label>
								<input
									ref={connectionNameInputRef}
									className={positronClassNames(
										'parameter-input', 'text-input',
										{ 'error': connectionNameError }
									)}
									placeholder={localize('positron.connectionNamePlaceholder', 'e.g. My Connection')}
									type='text'
									value={connectionName}
									onChange={e => {
										setConnectionName(e.target.value);
										setConnectionNameError(false);
									}}
								/>
							</div>

							{/* Parameters */}
							{props.driver.metadata.parameters.map(parameter => {
								switch (parameter.type) {
									// Boolean parameter.
									case 'boolean': {
										return (
											<div key={parameter.id}>
												<Checkbox
													initialChecked={parameterFieldStates[parameter.id].value as boolean}
													label={parameter.label}
													onChanged={checked => setParameterFieldState(parameter.id, checked)}
												/>
											</div>
										);
									}

									// File parameter.
									case 'file': {
										return (
											<div key={parameter.id} className='parameter-field'>
												<label className='parameter-label'>{parameter.label}</label>
												<input
													className={positronClassNames(
														'parameter-input', 'text-input',
														{ 'error': parameterFieldStates[parameter.id].error }
													)}
													placeholder={parameter.placeholder}
													type='text'
													value={parameterFieldStates[parameter.id].value as string}
													onChange={e => setParameterFieldState(parameter.id, e.target.value)}
												/>
											</div>
										);
									}

									// Number parameter.
									case 'number': {
										return (
											<div key={parameter.id} className='parameter-field'>
												<label className='parameter-label'>{parameter.label}</label>
												<input
													className={positronClassNames(
														'parameter-input', 'text-input',
														{ 'error': parameterFieldStates[parameter.id].error }
													)}
													inputMode='numeric'
													placeholder={parameter.placeholder}
													type='text'
													value={String(parameterFieldStates[parameter.id].value ?? '')}
													onChange={e => {
														// Get the new value, trimming whitespace.
														const newValue = e.target.value.trim();

														// Parse the value as a number. Number('') === 0, so handle empty string first.
														const numericValue = newValue !== '' ? Number(newValue) : NaN;
														setParameterFieldState(parameter.id, isNaN(numericValue) ? undefined : numericValue);
													}}
												/>
											</div>
										);
									}

									// Option parameter.
									case 'option': {
										return (
											<div key={parameter.id} className='parameter-field'>
												<label className='parameter-label'>{parameter.label}</label>
												<select
													className={positronClassNames(
														'parameter-input', 'parameter-select',
														{ 'error': parameterFieldStates[parameter.id].error }
													)}
													value={parameterFieldStates[parameter.id].value as string}
													onChange={e => {
														setParameterFieldState(parameter.id, e.target.value);
													}}
												>
													{parameter.options?.map(option => (
														<option key={option} value={option}>{option}</option>
													))}
												</select>
											</div>
										);
									}

									// Password parameter.
									case 'password': {
										return (
											<div key={parameter.id} className='parameter-field'>
												<label className='parameter-label'>{parameter.label}</label>
												<input
													className={positronClassNames(
														'parameter-input', 'text-input',
														{ 'error': parameterFieldStates[parameter.id].error }
													)}
													placeholder={parameter.placeholder}
													type='password'
													value={parameterFieldStates[parameter.id].value as string}
													onChange={e => setParameterFieldState(parameter.id, e.target.value ?? undefined)}
												/>
											</div>
										);
									}

									// String parameter.
									case 'string': {
										return (
											<div key={parameter.id} className='parameter-field'>
												<label className='parameter-label'>{parameter.label}</label>
												<input
													className={positronClassNames(
														'parameter-input', 'text-input',
														{ 'error': parameterFieldStates[parameter.id].error }
													)}
													placeholder={parameter.placeholder}
													type='text'
													value={parameterFieldStates[parameter.id].value as string}
													onChange={e => setParameterFieldState(parameter.id, e.target.value ?? undefined)}
												/>
											</div>
										);
									}
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
					onPrimaryButton={saveHandler}
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
