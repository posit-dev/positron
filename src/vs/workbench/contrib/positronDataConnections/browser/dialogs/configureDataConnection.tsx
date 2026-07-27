/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './configureDataConnection.css';

// React.
import { useCallback, useEffect, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { FileFilter } from '../../../../../platform/dialogs/common/dialogs.js';
import { combineLabelWithPathUri, pathUriToLabel } from '../../../../browser/utils/path.js';
import { ConfigureDataConnectionParameters } from './configureDataConnectionParameters.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { PositronModalDialogReactRenderer } from '../../../../../base/browser/positronModalDialogReactRenderer.js';
import { TwoButtonFooter } from '../../../../browser/positronComponents/positronDynamicModalDialog/components/twoButtonFooter.js';
import { ThreeButtonFooter } from '../../../../browser/positronComponents/positronDynamicModalDialog/components/threeButtonFooter.js';
import { PositronDynamicModalDialog } from '../../../../browser/positronComponents/positronDynamicModalDialog/positronDynamicModalDialog.js';
import { DataConnectionParameterValues, IDataConnectionDriver, IDataConnectionMechanism, IDataConnectionProfile } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';

/**
 * UI-side form state for a single parameter field, pairing the value with an error indicator.
 */
export interface ParameterFieldState {
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
export type ParameterFieldStates = Record<string, ParameterFieldState>;

/**
 * Builds the "Browse..." file-picker filters for a file parameter. The filters the driver declared
 * on the parameter are listed first so the driver's file type is the default selection in the
 * picker, followed by an "All Files" option for databases stored with a non-standard extension.
 * Parameters that declare no filters get "All Files" only.
 * @param declaredFilters The filters declared on the file parameter, if any.
 * @returns The ordered list of file filters for the open dialog.
 */
export function getFileDialogFilters(declaredFilters: FileFilter[] | undefined): FileFilter[] {
	return [
		...declaredFilters ?? [],
		{
			name: localize('positron.configureDataConnection.allFiles', "All Files"),
			extensions: ['*'],
		},
	];
}

/**
 * ConfigureDataConnectionProps interface.
 */
interface ConfigureDataConnectionProps {
	// The renderer.
	renderer: PositronModalDialogReactRenderer;

	// The driver for the connection being configured.
	driver: IDataConnectionDriver;

	// The mechanism the connection is being configured with. Its parameters drive the form.
	mechanism: IDataConnectionMechanism;

	// The profile. Omit when creating a new profile.
	profile?: IDataConnectionProfile;

	// Called when the user clicks Save to save the profile.
	onSave: (profile: IDataConnectionProfile) => void;

	// Called when the user clicks the Back button to return to the previous step. If not provided, the Back
	// button will not be shown.
	onBack?: () => void;
}

/**
 * ConfigureDataConnection component.
 * Displays a dialog with the connection configuration form for the selected driver.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const ConfigureDataConnection = (props: ConfigureDataConnectionProps) => {
	// Services.
	const { fileDialogService, labelService, pathService, positronDataConnectionsService } = usePositronReactServicesContext();

	// Ref to the Connection Name input so we can drive initial focus to it (overriding the
	// primary button's autoFocus, which fires during React commit before this effect runs).
	const connectionNameInputRef = useRef<HTMLInputElement>(null);

	// Focus the Connection Name input when the dialog mounts.
	useEffect(() => {
		connectionNameInputRef.current?.focus();
	}, []);

	// Ids of parameters that already have a secret saved for this profile. Secret fields for these
	// show a "saved" placeholder, and leaving them blank on submit keeps the existing secret rather
	// than clearing it.
	const [storedSecretIds] = useState<ReadonlySet<string>>(() => new Set(
		props.profile ? positronDataConnectionsService.getProfileSecretIds(props.profile.id) : []
	));

	// Redacted previews (parameter id -> redacted string) for unmasked secret parameters that have a
	// stored value, shown as the field placeholder when editing (e.g. a connection string with its
	// password masked). The cleartext is redacted by the driver and never loaded into this component.
	const [redactedSecretValues, setRedactedSecretValues] = useState<Record<string, string>>({});

	// On mount, fetch redacted previews for any unmasked secret parameters with a stored value.
	useEffect(() => {
		const profileId = props.profile?.id;
		if (!profileId) {
			return;
		}

		// Unmasked secret string parameters render in plaintext, so a "saved" dots placeholder would be
		// misleading; show a driver-redacted preview of the stored value instead.
		const unmaskedSecretIds = props.mechanism.parameters
			.filter(parameter => parameter.type === 'string' && parameter.secret === true && parameter.masked === false && storedSecretIds.has(parameter.id))
			.map(parameter => parameter.id);

		let disposed = false;
		Promise.all(unmaskedSecretIds.map(async parameterId => {
			const redacted = await positronDataConnectionsService.getRedactedParameterValue(profileId, parameterId);
			return [parameterId, redacted] as const;
		})).then(entries => {
			if (disposed) {
				return;
			}
			setRedactedSecretValues(Object.fromEntries(entries.filter((entry): entry is [string, string] => entry[1] !== undefined)));
		});

		return () => { disposed = true; };
	}, [positronDataConnectionsService, props.profile?.id, props.mechanism.parameters, storedSecretIds]);

	// State.
	const [connectionName, setConnectionName] = useState(props.profile?.connectionName ?? '');
	const [connectionNameError, setConnectionNameError] = useState(false);
	const [parameterFieldStates, setParameterFieldStates] = useState<ParameterFieldStates>(() => {
		// Initialize parameter field states.
		const initialParameterFieldStates: ParameterFieldStates = {};
		for (const parameter of props.mechanism.parameters) {
			// Get the default value for the parameter. Password parameters and secret string
			// parameters do not have a default value in the type system.
			let defaultValue: boolean | number | string | undefined;
			if (parameter.type === 'password' || (parameter.type === 'string' && parameter.secret)) {
				defaultValue = undefined;
			} else if (parameter.type === 'option') {
				// A <select> always shows a selection (the first option when none is set) and only
				// fires onChange when the selection changes. Seed the state to the option the control
				// already displays, so a required option validates without the user re-picking it.
				defaultValue = parameter.defaultValue ?? parameter.options[0];
			} else {
				defaultValue = parameter.defaultValue;
			}

			// Set the initial value for the parameter. Use the value from the profile if available;
			// otherwise fall back to the default value (if any). For required parameters, leaving
			// the value as undefined will trigger a validation error until the user provides a value.
			initialParameterFieldStates[parameter.id] = {
				value: props.profile?.parameterValues[parameter.id] ?? defaultValue ?? undefined,
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

	// Browse handler for file parameters. Opens a file picker (native on desktop, quick-picker on
	// web/remote via IFileDialogService) and fills the field with the chosen path on selection.
	const browseFileHandler = useCallback(async (parameterId: string) => {
		// Seed the dialog's starting location from the current value when present, otherwise the
		// default file path. defaultFilePath() yields a URI with the correct scheme/authority for
		// local vs remote; combineLabelWithPathUri re-homes the typed path onto the server platform.
		const currentValue = parameterFieldStates[parameterId]?.value;
		const defaultFilePath = await fileDialogService.defaultFilePath();
		const defaultUri = typeof currentValue === 'string' && currentValue.length > 0
			? await combineLabelWithPathUri(currentValue, defaultFilePath, pathService)
			: defaultFilePath;

		// Show the open dialog. The filters default to the file type the driver declared on the
		// parameter (e.g. DuckDB files for the DuckDB driver), while still offering "All Files".
		const parameter = props.mechanism.parameters.find(parameter => parameter.id === parameterId);
		const uris = await fileDialogService.showOpenDialog({
			title: localize('positron.configureDataConnection.selectFile', "Select File"),
			defaultUri,
			openLabel: localize('positron.configureDataConnection.select', "Select"),
			canSelectFiles: true,
			canSelectFolders: false,
			canSelectMany: false,
			filters: getFileDialogFilters(parameter?.type === 'file' ? parameter.filters : undefined),
			// The chosen path is passed to the driver as a plain string and opened on the extension
			// host's file system, so restrict the picker to that file system. Without this, the
			// web/remote quick-pick dialog offers a "Show Local" button whose browser-local files
			// the driver could never open.
			availableFileSystems: [defaultFilePath.scheme],
		});

		// If the user made a selection, set the field to the chosen path, formatted for the platform
		// the server is running on.
		if (uris?.length) {
			setParameterFieldState(parameterId, pathUriToLabel(uris[0], labelService));
		}
	}, [fileDialogService, labelService, parameterFieldStates, pathService, props.mechanism.parameters, setParameterFieldState]);

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

		// Validate the parameters.
		const updatedParameterFieldStates = { ...parameterFieldStates };
		for (const parameter of props.mechanism.parameters) {
			// Get the current value for this parameter field.
			const value = parameterFieldStates[parameter.id].value;

			// Determine if there is a validation error for this parameter. A required parameter
			// is invalid when its value is undefined, with one exception: a secret parameter that
			// already has a stored value can be left blank to keep the stored value.
			const isSecret = parameter.type === 'password' || (parameter.type === 'string' && parameter.secret === true);
			const hasStoredSecret = isSecret && storedSecretIds.has(parameter.id);
			const hasError = parameter.required === true && value === undefined && !hasStoredSecret;

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
			props.onSave({
				id: props.profile?.id ?? generateUuid(),
				createdAt: props.profile?.createdAt ?? Date.now(),
				lastUsedAt: props.profile?.lastUsedAt,
				driverMetadata: {
					id: props.driver.metadata.id,
					name: props.driver.metadata.name,
					iconSvg: props.driver.metadata.iconSvg,
					supportedLanguageIds: props.driver.metadata.supportedLanguageIds,
				},
				connectionName,
				mechanismId: props.mechanism.id,
				parameterValues,
			});
		}
	}, [connectionName, parameterFieldStates, props, storedSecretIds]);

	// Render.
	return (
		<PositronDynamicModalDialog
			content={
				<div className='configure-data-connection-container'>
					<div className='configure-data-connection'>
						{/* Driver Header. */}
						{/* <div className='driver-header'>
							<div className='driver-header-badge'>
								<img alt='' className='driver-header-icon' src={`data:image/svg+xml;base64,${props.driver.metadata.iconSvg}`} />
							</div>
							<div className='driver-header-name'>{props.driver.metadata.name}</div>
						</div> */}

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
						<ConfigureDataConnectionParameters
							parameterFieldStates={parameterFieldStates}
							parameters={props.mechanism.parameters}
							redactedSecretValues={redactedSecretValues}
							storedSecretIds={storedSecretIds}
							onBrowseFile={browseFileHandler}
							onParameterChanged={setParameterFieldState}
						/>

					</div>
				</div>
			}
			footer={
				props.onBack
					? <ThreeButtonFooter
						leftButtonTitle={localize('positron.configureDataConnection.back', "Back")}
						primaryButtonTitle={localize('positron.configureDataConnection.save', "Save")}
						secondaryButtonTitle={localize('positron.configureDataConnection.cancel', "Cancel")}
						topBorder={true}
						onLeftButton={props.onBack}
						onPrimaryButton={saveHandler}
						onSecondaryButton={cancelHandler}
					/>
					: <TwoButtonFooter
						primaryButtonTitle={localize('positron.configureDataConnection.save', "Save")}
						secondaryButtonTitle={localize('positron.configureDataConnection.cancel', "Cancel")}
						topBorder={true}
						onPrimaryButton={saveHandler}
						onSecondaryButton={cancelHandler}
					/>
			}
			renderer={props.renderer}
			title={localize(
				'positron.configureDataConnection.title',
				"Configure Data Connection \u00B7 {0}",
				props.driver.metadata.name
			)}
			titleSize='large'
			width={530}
			onCancel={cancelHandler}
			onSubmit={saveHandler}
		/>
	);
};
