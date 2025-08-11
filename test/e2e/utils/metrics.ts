/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import os from 'os';
import { request } from 'undici';
import { MultiLogger } from '../infra/logger.js';

const CONNECT_API_KEY = process.env.CONNECT_API_KEY!;
const PROD_API_URL = 'https://connect.posit.it/e2e-test-insights-api/metrics';
const LOCAL_API_URL = 'http://127.0.0.1:8000/metrics';

const platform_os = (() => {
	const platform = os.platform();
	if (platform === 'darwin') return 'macOS';
	if (platform === 'win32') return 'Windows';
	if (platform === 'linux') return 'Linux';
	return platform;
})();

const platform_version = os.release();
const app_version = '2.1.1'; // Replace with dynamic lookup if needed

// Discriminated union for PerfMetric using feature_area and corresponding action types
export type PerfMetric =
	| {
		env?: MetricEnv;
		feature_area: 'data_explorer';
		action: DataExplorerAction;
		target_type: MetricTargetType;
		duration_ms: number;
		status?: MetricStatus;
		target_description?: string;
		context_json?: MetricContext;
	}
	| {
		env?: MetricEnv;
		feature_area: 'notebooks';
		action: NotebooksAction;
		target_type: MetricTargetType;
		duration_ms: number;
		status?: MetricStatus;
		target_description?: string;
		context_json?: MetricContext;
	};

export type MetricEnv = 'production' | 'local';
type DataExplorerAction = 'filter' | 'sort' | 'to_code' | 'load_data';
type NotebooksAction = 'run_cell' | 'open_notebook' | 'save_notebook';


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

type MetricStatus = 'success' | 'error';
type MetricContext = {
	language?: string;
	data_rows?: number;
	data_cols?: number;
	sort_applied?: boolean;
	filter_applied?: boolean;
	preview_enabled?: boolean;
};

// Helper types for better TypeScript autocomplete
export type DataExplorerMetric = {
	env?: MetricEnv;
	feature_area: 'data_explorer';
	action: DataExplorerAction;
	target_type: MetricTargetType;
	duration_ms: number;
	status?: MetricStatus;
	target_description?: string;
	context_json?: MetricContext;
};

export type NotebookMetric = {
	env?: MetricEnv;
	feature_area: 'notebooks';
	action: NotebooksAction;
	target_type: MetricTargetType;
	duration_ms: number;
	status?: MetricStatus;
	target_description?: string;
	context_json?: MetricContext;
};

// Helper functions for better autocomplete
export function createDataExplorerMetric(params: Omit<DataExplorerMetric, 'feature_area' | 'duration_ms'>): Omit<DataExplorerMetric, 'duration_ms'> {
	return {
		feature_area: 'data_explorer',
		...params
	};
}

export function createNotebookMetric(params: Omit<NotebookMetric, 'feature_area' | 'duration_ms'>): Omit<NotebookMetric, 'duration_ms'> {
	return {
		feature_area: 'notebooks',
		...params
	};
}

export async function logMetric({
	env = 'local',
	feature_area,
	action,
	target_type,
	target_description,
	duration_ms,
	status = 'success',
	context_json = {}
}: PerfMetric, logger: MultiLogger) {
	const API_URL = env === 'production' ? PROD_API_URL : LOCAL_API_URL;

	const payload = {
		timestamp: new Date().toISOString(),
		app_version,
		platform_os,
		platform_version,
		run_id: process.env.RUN_ID ?? 'unknown',
		feature_area,
		action,
		target_type,
		duration_ms,
		status,
		target_description,
		context: JSON.stringify(context_json)
	};
	logger.log(`--- Log Metric: ${payload.feature_area} - ${payload.action} - ${payload.target_type} ---`);
	logger.log(`Payload: ${API_URL}\n${JSON.stringify(payload, null, 2)}`);

	try {
		const response = await request(API_URL, {
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
		console.error('Failed to send metrics:', error);
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		const errorCode = error instanceof Error && 'code' in error ? error.code : 'No code';

		console.error('Error details:', {
			message: errorMessage,
			code: errorCode,
			url: API_URL
		});
		logger.log(`Failed to send metric: ${errorMessage} (Code: ${errorCode})`);

		return {
			statusCode: 0,
			ok: false,
			body: `Error: ${errorMessage}`
		};
	}
}
