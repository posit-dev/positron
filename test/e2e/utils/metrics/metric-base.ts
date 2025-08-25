/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import os from 'os';
import { DataExplorerShortcutOptions } from './metric-data-explorer.js';

export const CONNECT_API_KEY = process.env.CONNECT_API_KEY!;
export const PROD_API_URL = 'https://connect.posit.it/e2e-test-insights-api/metrics';
export const LOCAL_API_URL = 'http://127.0.0.1:8000/metrics';

export const platformOs = (() => {
	const osMap = {
		darwin: 'macOS',
		win32: 'Windows',
		linux: 'Linux'
	};
	const platform = os.platform();
	return osMap[platform as keyof typeof osMap] || platform;
})();

export const platformVersion = os.release();

//-----------------------
// Base Metric Types
//-----------------------

export type GhBranch = 'main' | 'local';
export type MetricRuntimeEnv = 'electron' | 'chromium';
export type MetricStatus = 'success' | 'error';
export type MetricContext = {
	language?: string;
	data_rows?: number;
	data_cols?: number;
	sort_applied?: boolean;
	filter_applied?: boolean;
	preview_enabled?: boolean;
};

export type MetricResult<T> = {
	result: T;
	duration_ms: number;
};

export type RecordMetric = {
	dataExplorer: {
		loadData: <T>(operation: () => Promise<T>, targetType: MetricTargetType, options?: DataExplorerShortcutOptions) => Promise<MetricResult<T>>;
		filter: <T>(operation: () => Promise<T>, targetType: MetricTargetType, options?: DataExplorerShortcutOptions) => Promise<MetricResult<T>>;
		sort: <T>(operation: () => Promise<T>, targetType: MetricTargetType, options?: DataExplorerShortcutOptions) => Promise<MetricResult<T>>;
		toCode: <T>(operation: () => Promise<T>, targetType: MetricTargetType, options?: DataExplorerShortcutOptions) => Promise<MetricResult<T>>;
	};
	notebooks: {
		runCell: <T>(operation: () => Promise<T>, targetType: MetricTargetType, language?: string, description?: string, context?: MetricContext | (() => Promise<MetricContext>)) => Promise<MetricResult<T>>;
	};
};

export interface MetricResponse {
	statusCode: number;
	ok: boolean;
	body: string;
}

export type MetricTargetType =
	// In-memory data structures
	| 'r.data.frame'          // Base R data.frame
	| 'r.tibble'              // R tibble (tbl_df)
	| 'r.data.table'          // R data.table
	| 'py.pandas.DataFrame'   // Python pandas DataFrame
	| 'py.polars.DataFrame'   // Python polars DataFrame

	// File formats - uncompressed
	| 'file.parquet'          // Parquet files
	| 'file.csv'              // Comma-separated values
	| 'file.tsv'              // Tab-separated values
	| 'file.psv'              // Pipe-separated values
	| 'file.json'             // JSON files
	| 'file.xlsx'             // Excel files
	| 'file.feather'          // Feather/Arrow files

	// File formats - compressed
	| 'file.csv.gz'           // Gzipped CSV
	| 'file.tsv.gz'           // Gzipped TSV
	| 'file.json.gz'          // Gzipped JSON
	| 'file.parquet.snappy'   // Snappy-compressed Parquet
	| 'file.parquet.gzip'     // Gzip-compressed Parquet

	// Delimited variants
	| 'file.psv'              // Pipe-separated (|)
	| 'file.dsv'              // Custom delimiter-separated

	// Database connections
	| 'db.sqlite'             // SQLite database
	| 'db.postgres'           // PostgreSQL
	| 'db.mysql'              // MySQL

	// Remote/cloud sources
	| 'url.csv'               // Remote CSV URL
	| 'url.parquet'           // Remote Parquet URL
	| 's3.parquet'            // S3 object

	// Notebook cells
	| 'cell.r'                // R notebook cell
	| 'cell.python'           // Python notebook cell

export interface BaseMetric {
	branch?: GhBranch;
	runtime?: MetricRuntimeEnv;
	target_type: MetricTargetType;
	duration_ms: number;
	status?: MetricStatus;
	target_description?: string;
	context_json?: MetricContext;
}
