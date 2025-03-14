/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ColumnSchema, ColumnDisplayType } from '../../../../../services/languageRuntime/common/positronDataExplorerComm.js';

/**
 * Returns the data type icon for the column schema.
 * @returns The data type icon.
 */
export const columnSchemaDataTypeIcon = (columnSchema?: ColumnSchema) => {
	// Unknown.
	if (!columnSchema) {
		return 'codicon-question';
	}

	// Determine the alignment based on type.
	switch (columnSchema.type_display) {
		case ColumnDisplayType.Number:
			return 'codicon-positron-data-type-number';

		case ColumnDisplayType.Boolean:
			return 'codicon-positron-data-type-boolean';

		case ColumnDisplayType.String:
			return 'codicon-positron-data-type-string';

		case ColumnDisplayType.Date:
			return 'codicon-positron-data-type-date';

		case ColumnDisplayType.Datetime:
			return 'codicon-positron-data-type-date-time';

		case ColumnDisplayType.Time:
			return 'codicon-positron-data-type-time';

		// Reuse datetime icon for interval for now.
		case ColumnDisplayType.Interval:
			return 'codicon-positron-data-type-date-time';

		case ColumnDisplayType.Object:
			return 'codicon-positron-data-type-object';

		case ColumnDisplayType.Array:
			return 'codicon-positron-data-type-array';

		case ColumnDisplayType.Struct:
			return 'codicon-positron-data-type-struct';

		case ColumnDisplayType.Unknown:
			return 'codicon-positron-data-type-unknown';

		// This shouldn't ever happen.
		default:
			return 'codicon-question';
	}
};
