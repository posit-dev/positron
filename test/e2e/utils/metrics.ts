/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import os from 'os';
import { request } from 'undici';
import { MultiLogger } from '../infra/logger.js';

//-----------------------------------------------------------------------------
// Configuration Constants
//-----------------------------------------------------------------------------

const CONNECT_API_KEY = process.env.CONNECT_API_KEY!;
const PROD_API_URL = 'https://connect.posit.it/e2e-test-insights-api/metrics';
const LOCAL_API_URL = 'http://127.0.0.1:8000/metrics';

//-----------------------------------------------------------------------------
// Platform Information
//-----------------------------------------------------------------------------

const platformOs = (() => {
	const osMap = {
		darwin: 'macOS',
		win32: 'Windows',
		linux: 'Linux'
	};
	const platform = os.platform();
	return osMap[platform as keyof typeof osMap] || platform;
})();

const platformVersion = os.release();

//-----------------------------------------------------------------------------
// Base Metric Types
//-----------------------------------------------------------------------------

/**
 * Environment setting for metrics collection
 */
export type GhBranch = 'main' | 'local';

/**
 * Runtime environment information
 */
export type MetricRuntimeEnv = 'electron' | 'chromium';

/**
 * Status of the operation being measured
 */
export type MetricStatus = 'success' | 'error';

/**
 * Additional contextual information for metrics
 */
export type MetricContext = {
	language?: string;
	data_rows?: number;
	data_cols?: number;
	sort_applied?: boolean;
	filter_applied?: boolean;
	preview_enabled?: boolean;
};

/**
 * Response type for the logMetric function
 */
export interface MetricResponse {
	statusCode: number;
	ok: boolean;
	body: string;
}

//-----------------------------------------------------------------------------
// Feature-specific Types
//-----------------------------------------------------------------------------

/**
 * Actions available in the Data Explorer
 */
export type DataExplorerAction = 'filter' | 'sort' | 'to_code' | 'load_data';

/**
 * Actions available in Notebooks
 */
export type NotebooksAction = 'run_cell' | 'open_notebook' | 'save_notebook';

/**
 * Target types for metrics tracking
 */
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
	| 's3.parquet';           // S3 object

//-----------------------------------------------------------------------------
// Metric Data Structures
//-----------------------------------------------------------------------------

/**
 * Base metric properties common to all feature areas
 */
interface BaseMetric {
	branch?: GhBranch;
	runtime?: MetricRuntimeEnv;
	target_type: MetricTargetType;
	duration_ms: number;
	status?: MetricStatus;
	target_description?: string;
	context_json?: MetricContext;
}

/**
 * Helper type for Data Explorer metrics
 */
export type DataExplorerMetric = BaseMetric & {
	feature_area: 'data_explorer';
	action: DataExplorerAction;
};

/**
 * Helper type for Notebook metrics
 */
export type NotebookMetric = BaseMetric & {
	feature_area: 'notebooks';
	action: NotebooksAction;
};

/**
 * Discriminated union for all performance metrics
 */
export type PerfMetric = DataExplorerMetric | NotebookMetric;

//-----------------------------------------------------------------------------
// Factory Functions
//-----------------------------------------------------------------------------

/**
 * Creates a data explorer metric object with the feature_area preset
 *
 * @param params Parameters for the metric excluding feature_area and duration_ms
 * @returns A partially complete metric object ready for duration_ms to be added
 */
export function createDataExplorerMetric(params: Omit<DataExplorerMetric, 'feature_area' | 'duration_ms'>): Omit<DataExplorerMetric, 'duration_ms'> {
	return {
		feature_area: 'data_explorer',
		...params
	};
}

/**
 * Creates a notebook metric object with the feature_area preset
 *
 * @param params Parameters for the metric excluding feature_area and duration_ms
 * @returns A partially complete metric object ready for duration_ms to be added
 */
export function createNotebookMetric(params: Omit<NotebookMetric, 'feature_area' | 'duration_ms'>): Omit<NotebookMetric, 'duration_ms'> {
	return {
		feature_area: 'notebooks',
		...params
	};
}

//-----------------------------------------------------------------------------
// API Functions
//-----------------------------------------------------------------------------

/**
 * Logs a performance metric to the configured endpoint
 *
 * @param metric The performance metric to log
 * @param logger Logger for recording status and debugging information
 * @returns Response with status code and message
 */
export async function logMetric({
	feature_area,
	action,
	target_type,
	target_description,
	duration_ms,
	status = 'success',
	context_json = {}
}: PerfMetric, isElectronApp: boolean, logger: MultiLogger): Promise<MetricResponse> {
	const apiUrl = process.env.GITHUB_REF_NAME === 'main' ? PROD_API_URL : LOCAL_API_URL;

	const payload = {
		timestamp: new Date().toISOString(),
		platform_os: platformOs,
		platform_version: platformVersion,
		runtime_env: isElectronApp ? 'electron' : 'chromium',
		run_id: process.env.GITHUB_RUN_ID ?? process.env.RUN_ID ?? 'unknown',
		feature_area,
		action,
		target_type,
		duration_ms,
		status,
		target_description,
		context: JSON.stringify(context_json)
	};

	logger.log(`--- Log Metric: ${payload.feature_area} - ${payload.action} - ${payload.target_type} ---`);
	logger.log(`Payload: ${apiUrl}\n${JSON.stringify(payload, null, 2)}`);

	try {
		const response = await request(apiUrl, {
			method: 'POST',
			headers: {
				Authorization: `Key ${CONNECT_API_KEY}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(payload)
		});

		const responseBody = await response.body.text();
		logger.log(`Response body: ${responseBody}`);

		return {
			statusCode: response.statusCode,
			ok: response.statusCode < 400,
			body: responseBody
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		const errorCode = error instanceof Error && 'code' in error ?
			(error as Error & { code: string | number }).code : 'No code';

		logger.log('Error details:', {
			message: errorMessage,
			code: errorCode,
			url: apiUrl
		});

		return {
			statusCode: 0,
			ok: false,
			body: `Error: ${errorMessage}`
		};
	}
}
