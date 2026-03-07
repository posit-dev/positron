/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../../../base/common/themables.js';
import { ColumnSchema, ColumnDisplayType } from '../../../../../services/languageRuntime/common/positronDataExplorerComm.js';

/**
 * Returns the data type icon for the column schema.
 * @returns The data type icon.
 */
export const columnSchemaDataTypeIcon = (columnSchema?: ColumnSchema): ThemeIcon => {
	// Unknown.
	if (!columnSchema) {
		return Codicon.question;
	}

	// Determine the alignment based on type.
	switch (columnSchema.type_display) {
		case ColumnDisplayType.Floating:
		case ColumnDisplayType.Integer:
		case ColumnDisplayType.Decimal:
			return Codicon.positronDataTypeNumber;

		case ColumnDisplayType.Boolean:
			return Codicon.positronDataTypeBoolean;

		case ColumnDisplayType.String:
			return Codicon.positronDataTypeString;

		case ColumnDisplayType.Date:
			return Codicon.positronDataTypeDate;

		case ColumnDisplayType.Datetime:
			return Codicon.positronDataTypeDateTime;

		case ColumnDisplayType.Time:
			return Codicon.positronDataTypeTime;

		// Reuse datetime icon for interval for now.
		case ColumnDisplayType.Interval:
			return Codicon.positronDataTypeDateTime;

		case ColumnDisplayType.Object:
			return Codicon.positronDataTypeObject;

		case ColumnDisplayType.Array:
			return Codicon.positronDataTypeArray;

		case ColumnDisplayType.Struct:
			return Codicon.positronDataTypeStruct;

		case ColumnDisplayType.Unknown:
			return Codicon.positronDataTypeUnknown;

		// This shouldn't ever happen.
		default:
			return Codicon.question;
	}
};
