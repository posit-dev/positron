/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { JSX } from 'react';

// Other dependencies.
import { ParameterFieldStates } from './configureDataConnection.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { Checkbox } from '../../../../../base/browser/ui/positronComponents/checkbox/checkbox.js';
import { IDataConnectionParameter } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';

/**
 * ConfigureDataConnectionParametersProps interface.
 */
interface ConfigureDataConnectionParametersProps {
	// The parameters to render fields for, as defined by the driver.
	parameters: readonly IDataConnectionParameter[];

	// Ids of parameters that already have a secret saved for this profile. Secret fields for these
	// show a "saved" placeholder, and leaving them blank on submit keeps the existing secret rather
	// than clearing it.
	storedSecretIds: ReadonlySet<string>;

	// The current value and error state of each parameter field, managed by the parent component.
	parameterFieldStates: ParameterFieldStates;

	// Callback to notify the parent component of changes to any parameter field.
	onParameterChanged: (parameterId: string, value: boolean | number | string | undefined) => void;
}

// Placeholder shown in secret fields that already have a stored value. The user sees that something
// is set without ever loading the actual secret into the DOM.
const STORED_SECRET_PLACEHOLDER = '••••••••';

/**
 * ConfigureDataConnectionParameters component. Renders the per-parameter form fields for the
 * selected driver, dispatching value changes back to the parent via onParameterChanged.
 */
export const ConfigureDataConnectionParameters = ({
	parameters,
	storedSecretIds,
	parameterFieldStates,
	onParameterChanged,
}: ConfigureDataConnectionParametersProps): JSX.Element => {
	return (
		<>
			{parameters.map(parameter => {
				switch (parameter.type) {
					// Boolean parameter.
					case 'boolean': {
						return (
							<div key={parameter.id}>
								<Checkbox
									initialChecked={parameterFieldStates[parameter.id].value as boolean}
									label={parameter.label}
									onChanged={checked => onParameterChanged(parameter.id, checked)}
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
									onChange={e => onParameterChanged(parameter.id, e.target.value)}
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
										onParameterChanged(parameter.id, isNaN(numericValue) ? undefined : numericValue);
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
									onChange={e => onParameterChanged(parameter.id, e.target.value)}
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
						// Show the saved-secret placeholder when a value is stored and the field
						// hasn't been edited; otherwise the driver-supplied placeholder.
						const fieldValue = parameterFieldStates[parameter.id].value as string;
						const showStoredPlaceholder = storedSecretIds.has(parameter.id) && !fieldValue;
						return (
							<div key={parameter.id} className='parameter-field'>
								<label className='parameter-label'>{parameter.label}</label>
								<input
									className={positronClassNames(
										'parameter-input',
										'text-input',
										{ 'error': parameterFieldStates[parameter.id].error }
									)}
									placeholder={showStoredPlaceholder ? STORED_SECRET_PLACEHOLDER : parameter.placeholder}
									type='password'
									value={fieldValue}
									onChange={e => onParameterChanged(parameter.id, e.target.value ?? undefined)}
								/>
							</div>
						);
					}

					// String parameter.
					case 'string': {
						// Secret-typed strings get the saved-secret placeholder treatment too.
						const fieldValue = parameterFieldStates[parameter.id].value as string;
						const showStoredPlaceholder = parameter.secret === true && storedSecretIds.has(parameter.id) && !fieldValue;
						return (
							<div key={parameter.id} className='parameter-field'>
								<label className='parameter-label'>{parameter.label}</label>
								<input
									className={positronClassNames(
										'parameter-input',
										'text-input',
										{ 'error': parameterFieldStates[parameter.id].error }
									)}
									placeholder={showStoredPlaceholder ? STORED_SECRET_PLACEHOLDER : parameter.placeholder}
									type={parameter.secret === true ? 'password' : 'text'}
									value={fieldValue}
									onChange={e => onParameterChanged(parameter.id, e.target.value ?? undefined)}
								/>
							</div>
						);
					}
				}
			})}
		</>
	);
};
