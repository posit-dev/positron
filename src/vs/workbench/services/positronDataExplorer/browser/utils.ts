/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ClipboardCell, ClipboardCellIndexes, ClipboardColumnIndexes, ClipboardData, ClipboardRowIndexes } from '../../../browser/positronDataGrid/classes/dataGridInstance.js';
import { DataSelectionCellIndices, DataSelectionIndices, DataSelectionSingleCell, TableSelection, TableSelectionKind } from '../../languageRuntime/common/positronDataExplorerComm.js';

/**
 * Builds a TableSelection from ClipboardData for use with exportDataSelection.
 * @param clipboardData The clipboard data to convert.
 * @returns The corresponding TableSelection, or undefined if the clipboard data type is unknown.
 */
export function buildTableSelectionFromClipboardData(
	clipboardData: ClipboardData
): TableSelection | undefined {
	if (clipboardData instanceof ClipboardCell) {
		const selection: DataSelectionSingleCell = {
			column_index: clipboardData.columnIndex,
			row_index: clipboardData.rowIndex,
		};
		return { kind: TableSelectionKind.SingleCell, selection };
	} else if (clipboardData instanceof ClipboardCellIndexes) {
		const selection: DataSelectionCellIndices = {
			column_indices: clipboardData.columnIndexes,
			row_indices: clipboardData.rowIndexes
		};
		return { kind: TableSelectionKind.CellIndices, selection };
	} else if (clipboardData instanceof ClipboardColumnIndexes) {
		const selection: DataSelectionIndices = {
			indices: clipboardData.indexes
		};
		return { kind: TableSelectionKind.ColumnIndices, selection };
	} else if (clipboardData instanceof ClipboardRowIndexes) {
		const selection: DataSelectionIndices = {
			indices: clipboardData.indexes
		};
		return { kind: TableSelectionKind.RowIndices, selection };
	}
	return undefined;
}
