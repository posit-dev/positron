/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './configureDataConnection.css';

// React.
import { useCallback } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { DataConnectionActionBar } from './dataConnectionActionBar.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { Checkbox } from '../../../../browser/positronComponents/positronModalDialog/components/checkbox.js';
import { ContentArea } from '../../../../browser/positronComponents/positronModalDialog/components/contentArea.js';
import { PositronModalDialog } from '../../../../browser/positronComponents/positronModalDialog/positronModalDialog.js';
import { IDataConnectionDriver, IDataConnectionProfile } from '../../../../services/positronDataConnections/common/interfaces/positronDataConnectionsDriver.js';

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

	// Cancel handler.
	const cancelHandler = useCallback(() => {
		// Dispose the renderer, which will close the dialog.
		renderer.dispose();
	}, [renderer]);

	// Accept handler.
	const acceptHandler = useCallback(() => {
		// TODO: Save the connection.
		renderer.dispose();
	}, [renderer]);

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
							className='parameter-input text-input'
							placeholder='connection name'
							type='text'
						/>
					</div>

					{/* Parameters */}
					{driver.metadata.parameters.map(parameter => {
						switch (parameter.type) {
							case 'string':
								return (
									<div key={parameter.id} className='parameter-field'>
										<label className='parameter-label'>{parameter.label}</label>
										<input
											className='parameter-input text-input'
											defaultValue={parameter.defaultValue as string | undefined}
											placeholder={parameter.placeholder}
											type='text'
										/>
									</div>
								);

							case 'number':
								return (
									<div key={parameter.id} className='parameter-field'>
										<label className='parameter-label'>{parameter.label}</label>
										<input
											className='parameter-input text-input'
											defaultValue={parameter.defaultValue !== undefined ? String(parameter.defaultValue) : undefined}
											inputMode='numeric'
											placeholder={parameter.placeholder}
											type='text'
										/>
									</div>
								);

							case 'boolean':
								return (
									<div key={parameter.id}>
										<Checkbox
											initialChecked={parameter.defaultValue as boolean | undefined}
											label={parameter.label}
											onChanged={() => { }}
										/>
									</div>
								);

							case 'file':
								return (
									<div key={parameter.id} className='parameter-field'>
										<label className='parameter-label'>{parameter.label}</label>
										<input
											className='parameter-input text-input'
											defaultValue={parameter.defaultValue as string | undefined}
											placeholder={parameter.placeholder}
											type='text'
										/>
									</div>
								);

							case 'option':
								return (
									<div key={parameter.id} className='parameter-field'>
										<label className='parameter-label'>{parameter.label}</label>
										<select
											className='parameter-input parameter-select'
											defaultValue={parameter.defaultValue as string | undefined}
										>
											{parameter.options?.map(option => (
												<option key={option} value={option}>{option}</option>
											))}
										</select>
									</div>
								);

							default:
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
