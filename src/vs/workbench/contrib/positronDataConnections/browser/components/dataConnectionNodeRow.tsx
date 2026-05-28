/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './dataConnectionNodeRow.css';

// Other dependencies.
import { IDataConnectionNodeDTO } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDTOs.js';

/**
 * Maps a DTO kind string to a codicon name. The driver-side kind values are free-form, so
 * unknown kinds fall back to a generic 'symbol-misc' icon. As specific kinds become common
 * across drivers, add entries here to upgrade their visual treatment.
 */
const kindIcon = (kind: string): string => {
	switch (kind) {
		case 'catalog':
		case 'database':
			return 'database';
		case 'schema':
			return 'symbol-namespace';
		case 'table':
			return 'table';
		case 'view':
			return 'eye';
		case 'column':
		case 'field':
			return 'symbol-field';
		case 'group-tables':
			return 'table';
		case 'group-views':
			return 'eye';
		case 'group-indexes':
			return 'key';
		case 'group-triggers':
			return 'zap';
		case 'trigger':
			return 'zap';
		case 'index':
			return 'key';
		default:
			return 'symbol-misc';
	}
};

interface DataConnectionNodeRowProps {
	dto: IDataConnectionNodeDTO;
}

/**
 * DataConnectionNodeRow component. Renders one server-side connection node (catalog, schema,
 * table, view, column, etc.) inside the tree.
 */
export const DataConnectionNodeRow = ({ dto }: DataConnectionNodeRowProps) => (
	<div className='data-connection-node-row'>
		<div className={`codicon codicon-${kindIcon(dto.kind)} data-connection-node-icon`} />
		<div className='data-connection-node-text'>{dto.name}</div>
		{dto.dataType && (
			<div className='data-connection-node-type'>{dto.dataType}</div>
		)}
	</div>
);
