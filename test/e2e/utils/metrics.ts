/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import os from 'os';
import { request } from 'undici';

const CONNECT_API_KEY = process.env.CONNECT_API_KEY!;
const PROD_API_URL = 'https://connect.posit.it/e2e-test-insights-api/metric';
const LOCAL_API_URL = 'http://127.0.0.1:8000/metric';

const platform_os = (() => {
	const platform = os.platform();
	if (platform === 'darwin') return 'macOS';
	if (platform === 'win32') return 'Windows';
	if (platform === 'linux') return 'Linux';
	return platform;
})();

const platform_version = os.release();
const app_version = '2.1.1'; // Replace with dynamic lookup if needed

export type PerfMetric = {
	env?: MetricEnv;
	feature_area: MetricFeatureArea;
	action: MetricAction;
	target_type: MetricTargetType;
	duration_ms: number;
	status?: MetricStatus;
	target_description?: string;
	context_json?: MetricContext;
}

export type MetricEnv = 'production' | 'local';
type MetricAction = 'filter' | 'sort' | 'to_code' | 'data_load' | 'load_data';
type MetricFeatureArea = 'data_explorer' | 'notebooks';
type MetricTargetType = 'data.frame' | 'data.table' | 'pandas.DataFrame' | 'polars.DataFrame' | 'tibble';
type MetricStatus = 'success' | 'error';
type MetricContext = {
	language?: string;
	data_rows?: number;
	data_cols?: number;
	sort_applied?: boolean;
	filter_applied?: boolean;
	preview_enabled?: boolean;
};

export async function logMetric({
	env = 'local',
	feature_area,
	action,
	target_type,
	target_description,
	duration_ms,
	status = 'success',
	context_json = {}
}: PerfMetric) {
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

		return {
			statusCode: 0,
			ok: false,
			body: `Error: ${errorMessage}`
		};
	}
}
