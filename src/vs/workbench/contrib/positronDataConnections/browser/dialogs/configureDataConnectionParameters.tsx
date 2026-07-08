/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { JSX } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { ParameterFieldStates } from './configureDataConnection.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
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

	// Driver-redacted previews (parameter id -> redacted string) for unmasked secret parameters with a
	// stored value. When present for a field, the redacted preview is shown as the placeholder instead
	// of the generic "saved" dots, so the user can see (a safe form of) what is stored.
	redactedSecretValues?: Record<string, string>;

	// The current value and error state of each parameter field, managed by the parent component.
	parameterFieldStates: ParameterFieldStates;

	// Callback to open a file picker for a file parameter. The parent owns the dialog interaction
	// and updates the field with the chosen path.
	onBrowseFile: (parameterId: string) => void;

	// Callback to notify the parent component of changes to any parameter field.
	onParameterChanged: (parameterId: string, value: boolean | number | string | undefined) => void;
}

// Placeholder shown in secret fields that already have a stored value. The user sees that something
// is set without ever loading the actual secret into the DOM.
const STORED_SECRET_PLACEHOLDER = '••••••••';

/**
 * Renders a parameter's label, appending a muted "(optional)" marker when the parameter is not
 * required. Marking optional fields (rather than required ones) needs no legend, matches the data
 * model where parameters are optional unless explicitly flagged required, and is announced as
 * meaningful text by screen readers.
 */
const ParameterLabel = ({ htmlFor, label, optional }: { htmlFor: string; label: string; optional: boolean }): JSX.Element => (
	<label className='parameter-label' htmlFor={htmlFor}>
		{label}
		{optional && <span className='parameter-optional'>{localize('positron.dataConnections.parameterOptional', "(optional)")}</span>}
	</label>
);

/**
 * Renders a parameter's optional description as help text beneath its field. Returns nothing when the
 * parameter has no description.
 */
const ParameterDescription = ({ text }: { text?: string }): JSX.Element | null =>
	text ? <span className='parameter-description'>{text}</span> : null;

/**
 * ConfigureDataConnectionParameters component. Renders the per-parameter form fields for the
 * selected driver, dispatching value changes back to the parent via onParameterChanged.
 */
export const ConfigureDataConnectionParameters = ({
	parameters,
	storedSecretIds,
	redactedSecretValues,
	parameterFieldStates,
	onBrowseFile,
	onParameterChanged,
}: ConfigureDataConnectionParametersProps): JSX.Element => {
	return (
		<>
			{parameters.map(parameter => {
				// Stable id linking each <label> to its control, so screen readers announce the label
				// (including the "(optional)" marker) when the field is focused.
				const fieldId = `data-connection-parameter-${parameter.id}`;
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
								<ParameterDescription text={parameter.description} />
							</div>
						);
					}

					// File parameter.
					case 'file': {
						return (
							<div key={parameter.id} className='parameter-field'>
								<ParameterLabel htmlFor={fieldId} label={parameter.label} optional={!parameter.required} />
								<div className='parameter-file-input'>
									<input
										aria-required={parameter.required || undefined}
										className={positronClassNames(
											'parameter-input', 'text-input',
											{ 'error': parameterFieldStates[parameter.id].error }
										)}
										id={fieldId}
										placeholder={parameter.placeholder}
										type='text'
										value={parameterFieldStates[parameter.id].value as string}
										onChange={e => onParameterChanged(parameter.id, e.target.value)}
									/>
									<Button className='browse-button' onPressed={() => onBrowseFile(parameter.id)}>
										{localize('positron.configureDataConnection.browse', "Browse...")}
									</Button>
								</div>
								<ParameterDescription text={parameter.description} />
							</div>
						);
					}

					// Number parameter.
					case 'number': {
						return (
							<div key={parameter.id} className='parameter-field'>
								<ParameterLabel htmlFor={fieldId} label={parameter.label} optional={!parameter.required} />
								<input
									aria-required={parameter.required || undefined}
									className={positronClassNames(
										'parameter-input', 'text-input',
										{ 'error': parameterFieldStates[parameter.id].error }
									)}
									id={fieldId}
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
								<ParameterDescription text={parameter.description} />
							</div>
						);
					}

					// Option parameter.
					case 'option': {
						return (
							<div key={parameter.id} className='parameter-field'>
								<ParameterLabel htmlFor={fieldId} label={parameter.label} optional={!parameter.required} />
								<select
									aria-required={parameter.required || undefined}
									className={positronClassNames(
										'parameter-input', 'parameter-select',
										{ 'error': parameterFieldStates[parameter.id].error }
									)}
									id={fieldId}
									value={parameterFieldStates[parameter.id].value as string}
									onChange={e => onParameterChanged(parameter.id, e.target.value)}
								>
									{parameter.options?.map(option => (
										<option key={option} value={option}>{option}</option>
									))}
								</select>
								<ParameterDescription text={parameter.description} />
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
								<ParameterLabel htmlFor={fieldId} label={parameter.label} optional={!parameter.required} />
								<input
									aria-required={parameter.required || undefined}
									className={positronClassNames(
										'parameter-input',
										'text-input',
										{ 'error': parameterFieldStates[parameter.id].error }
									)}
									id={fieldId}
									placeholder={showStoredPlaceholder ? STORED_SECRET_PLACEHOLDER : parameter.placeholder}
									type='password'
									value={fieldValue}
									onChange={e => onParameterChanged(parameter.id, e.target.value ?? undefined)}
								/>
								<ParameterDescription text={parameter.description} />
							</div>
						);
					}

					// String parameter.
					case 'string': {
						// Secret-typed strings get the saved-secret placeholder treatment too.
						const fieldValue = parameterFieldStates[parameter.id].value as string;
						// Secret strings are masked unless the driver opts out (masked: false), which
						// renders the value in plaintext while still storing it as a secret -- e.g. a
						// connection string the user should be able to read back as they type.
						const masked = parameter.secret === true && parameter.masked !== false;
						// When editing, an unmasked secret with a stored value shows a driver-redacted
						// preview of what is stored; a masked secret shows the generic dots. Either way,
						// leaving the field blank keeps the stored secret.
						const redactedValue = redactedSecretValues?.[parameter.id];
						const placeholder = !fieldValue && parameter.secret === true && storedSecretIds.has(parameter.id)
							? (redactedValue ?? STORED_SECRET_PLACEHOLDER)
							: parameter.placeholder;
						return (
							<div key={parameter.id} className='parameter-field'>
								<ParameterLabel htmlFor={fieldId} label={parameter.label} optional={!parameter.required} />
								<input
									aria-required={parameter.required || undefined}
									className={positronClassNames(
										'parameter-input',
										'text-input',
										{ 'error': parameterFieldStates[parameter.id].error }
									)}
									id={fieldId}
									placeholder={placeholder}
									type={masked ? 'password' : 'text'}
									value={fieldValue}
									onChange={e => onParameterChanged(parameter.id, e.target.value ?? undefined)}
								/>
								<ParameterDescription text={parameter.description} />
							</div>
						);
					}
				}
			})}
		</>
	);
};
