/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './dataConnectionInstance.css';

// Other dependencies.
import { IDataConnectionInstance } from '../../../../services/positronDataConnections/common/interfaces/positronDataConnectionsInstance.js';

/**
 * DataConnectionInstanceProps interface.
 */
interface DataConnectionInstanceProps {
	instance: IDataConnectionInstance;
}

/**
 * DataConnectionInstance component. Renders one live (active) connection row.
 */
export const DataConnectionInstance = ({ instance }: DataConnectionInstanceProps) => (
	<div className='data-connection-instance'>
		{instance.driverName}
	</div>
);
