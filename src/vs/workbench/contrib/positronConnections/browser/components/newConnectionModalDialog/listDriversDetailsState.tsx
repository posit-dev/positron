/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './listDriversDetailsState.css';


// React.
import React, { PropsWithChildren, useEffect } from 'react';
import { IDriver, Input } from '../../../../../services/positronConnections/common/interfaces/positronConnectionsDriver.js';
import { localize } from '../../../../../../nls.js';
import { PositronButton } from '../../../../../../base/browser/ui/positronComponents/button/positronButton.js';
import { usePositronReactServicesContext } from '../../../../../../base/browser/positronReactRendererContext.js';


interface ListDriversDetailsProps {
	readonly drivers: IDriver[];
	readonly onDriverSelected: (driver: IDriver) => void;
	readonly onBack: () => void;
	readonly onCancel: () => void;
}

export const ListDriversDetails = (props: PropsWithChildren<ListDriversDetailsProps>) => {
	const services = usePositronReactServicesContext();
	const drivers = props.drivers;
	const { onBack } = props;

	// drivers must be length > 1
	useEffect(() => {
		if (drivers.length <= 1) {
			services.notificationService.error(localize(
				'positron.connections.newConnectionModalDialog.listDriversDetails.invalidDriverSelection',
				'Unable to show driver details. Please select a driver again.'
			));
			onBack();
		}
	}, [drivers, onBack, services]);

	if (drivers.length <= 1) {
		return null;
	}

	const name = drivers[0].metadata.name;
	const summarizeInputs = (inputs: Input[]): React.ReactNode => {
		if (inputs.length === 0) {
			return localize(
				'positron.connections.newConnectionModalDialog.listDriversDetails.noInputs',
				'No inputs required'
			);
		}

		const labels = inputs.map(input => input.label).filter((label): label is string => Boolean(label));
		return labels.join(', ');
	};

	return <div className='connections-new-connection-list-drivers-details'>
		<div className='header'>
			<h1 className='title'>
				{localize(
					'positron.connections.newConnectionModalDialog.listDriversDetails.title',
					'Select a driver for {0}',
					name
				)}
			</h1>
			<div className='icon'>
				{drivers[0].metadata.base64EncodedIconSvg ? <img
					alt='' // decorative image
					src={`data:image/svg+xml;base64,${drivers[0].metadata.base64EncodedIconSvg}`}
				/> : null}
			</div>
		</div>
		<div className='drivers-list'>
			{drivers.map((driver) => (
				<button
					key={driver.driverId}
					className='driver-list-item'
					onClick={() => props.onDriverSelected(driver)}
				>
					<div className='driver-info'>
						<div className='driver-description'>
							{driver.metadata.description ?? localize(
								'positron.connections.newConnectionModalDialog.listDriversDetails.noDescription',
								'No description available'
							)}
							{':'}
						</div>
						<div className='driver-inputs'>
							<small>
								{'('}
								{summarizeInputs(driver.metadata.inputs)}
								{')'}
							</small>
						</div>
						<div className={`driver-button codicon codicon-chevron-right`}>
						</div>
					</div>
				</button>
			))}
		</div>
		<div className='footer'>
			<PositronButton
				className='button action-bar-button'
				onPressed={props.onBack}
			>
				{(() => localize('positron.resumeConnectionModalDialog.back', "Back"))()}
			</PositronButton>
			<PositronButton
				className='button action-bar-button right'
				onPressed={props.onCancel}
			>
				{(() => localize('positron.resumeConnectionModalDialog.cancel', "Cancel"))()}
			</PositronButton>
		</div>
	</div>;
}
