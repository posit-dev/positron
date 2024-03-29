/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ColumnSchema, ColumnSchemaTypeDisplay } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';

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
		case ColumnSchemaTypeDisplay.Number:
			return 'codicon-positron-data-type-number';

		case ColumnSchemaTypeDisplay.Boolean:
			return 'codicon-positron-data-type-boolean';

		case ColumnSchemaTypeDisplay.String:
			return 'codicon-positron-data-type-string';

		case ColumnSchemaTypeDisplay.Date:
			return 'codicon-positron-data-type-date';

		case ColumnSchemaTypeDisplay.Datetime:
			return 'codicon-positron-data-type-date-time';

		case ColumnSchemaTypeDisplay.Time:
			return 'codicon-positron-data-type-time';

		case ColumnSchemaTypeDisplay.Array:
			return 'codicon-positron-data-type-array';

		case ColumnSchemaTypeDisplay.Struct:
			return 'codicon-positron-data-type-struct';

		case ColumnSchemaTypeDisplay.Unknown:
			return 'codicon-positron-data-type-unknown';

		// This shouldn't ever happen.
		default:
			return 'codicon-question';
	}
};
