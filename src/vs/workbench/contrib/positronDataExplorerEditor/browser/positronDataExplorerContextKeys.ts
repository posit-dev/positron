/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { PositronDataExplorerEditorInput } from './positronDataExplorerEditorInput.js';
import { ContextKeyExpr, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { PositronDataExplorerLayout } from '../../../services/positronDataExplorer/browser/interfaces/positronDataExplorerService.js';

/**
 * A ContextKeyExpression that is true when the active editor is a Positron data explorer editor.
 */
export const POSITRON_DATA_EXPLORER_IS_ACTIVE_EDITOR = ContextKeyExpr.equals(
	'activeEditor',
	PositronDataExplorerEditorInput.EditorID
);

export const POSITRON_DATA_EXPLORER_IS_FOCUSED = ContextKeyExpr.equals(
	'positronDataExplorerFocused',
	true
);

/**
 * Raw context keys.
 */
export const POSITRON_DATA_EXPLORER_LAYOUT = new RawContextKey<PositronDataExplorerLayout>(
	'positronDataExplorerLayout',
	PositronDataExplorerLayout.SummaryOnLeft
);
export const POSITRON_DATA_EXPLORER_IS_COLUMN_SORTING = new RawContextKey<boolean>(
	'positronDataExplorerIsColumnSorting',
	false
);
export const POSITRON_DATA_EXPLORER_IS_PLAINTEXT = new RawContextKey<boolean>(
	'positronDataExplorerIsPlaintext',
	false
);
/**
 * Context key for whether the file backing the data explorer is an Excel
 * workbook (.xlsx). Used to swap the "Open as Plain Text File" action for an
 * "Open as Spreadsheet" action, which is only meaningful in the desktop app.
 */
export const POSITRON_DATA_EXPLORER_IS_XLSX = new RawContextKey<boolean>(
	'positronDataExplorerIsXlsx',
	false
);
export const POSITRON_DATA_EXPLORER_IS_CONVERT_TO_CODE_ENABLED = new RawContextKey<boolean>(
	'positronDataExplorerIsConvertToCodeEnabled',
	false
);
export const POSITRON_DATA_EXPLORER_CODE_SYNTAXES_AVAILABLE = new RawContextKey<boolean>(
	'positronDataExplorerCodeSyntaxesAvailable',
	false
);
export const POSITRON_DATA_EXPLORER_IS_ROW_FILTERING = new RawContextKey<boolean>(
	'positronDataExplorerIsRowFiltering',
	false
);

/**
 * Context key for whether has header row option is enabled (default true).
 * Only meaningful for delimited text files (CSV/TSV) opened with DuckDB backend.
 */
export const POSITRON_DATA_EXPLORER_FILE_HAS_HEADER_ROW = new RawContextKey<boolean>(
	'positronDataExplorerFileHasHeaderRow',
	true
);

/**
 * Context key for whether the Data Explorer is backed by a file on disk (the DuckDB extension
 * backend) rather than a kernel object. The real test is the duckdb: client-id prefix, read from
 * the instance's isFileBacked; the filename-based IS_PLAINTEXT key is only a proxy and misses
 * Parquet. Import Data shows on file-backed explorers; Convert to Code shows on the rest.
 */
export const POSITRON_DATA_EXPLORER_IS_FILE_BACKED = new RawContextKey<boolean>(
	'positronDataExplorerIsFileBacked',
	false
);
