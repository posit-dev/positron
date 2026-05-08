/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './dataConnectionProfile.css';

// Other dependencies.
import { IDataConnectionProfile } from '../../../../services/positronDataConnections/common/interfaces/positronDataConnectionsDriver.js';

/**
 * DataConnectionProfileProps interface.
 */
interface DataConnectionProfileProps {
	profile: IDataConnectionProfile;
}

/**
 * DataConnectionProfile component. Renders one saved (persisted) profile row.
 */
export const DataConnectionProfile = ({ profile }: DataConnectionProfileProps) => (
	<div className='data-connection-profile'>
		{profile.connectionName}
	</div>
);
