/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './configureDataConnection.css';

/**
 * ConfigureDataConnectionProps interface.
 */
interface ConfigureDataConnectionProps {
	// The ID of the selected driver.
	driverId: string;
}

/**
 * ConfigureDataConnection component.
 * Displays the connection configuration form for the selected driver.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const ConfigureDataConnection = (props: ConfigureDataConnectionProps) => {
	// Render.
	return (
		<div className='configure-data-connection'>
		</div>
	);
};
