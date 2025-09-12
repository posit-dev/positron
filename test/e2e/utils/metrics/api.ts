/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { request } from 'undici';
import { MultiLogger } from '../../infra/logger.js';
import {
	CONNECT_API_KEY,
	PROD_API_URL,
	LOCAL_API_URL,
	platformOs,
	platformVersion,
	MetricResponse,
	positronVersion
} from './metric-base.js';
import { SPEC_NAME } from '../../fixtures/test-setup/constants.js';

export type PerfMetric = {
	feature_area: string;
	action: string;
	target_type: string;
	target_description?: string;
	duration_ms: number;
	status?: 'success' | 'error';
	context_json?: any;
	spec_name?: string;
};

export type MetricPayload = {
	timestamp: string;
	app_version: string;
	build_number: string;
	platform_os: string;
	platform_version: string;
	runtime_env: string;
	run_id: string;
	feature_area: string;
	action: string;
	target_type: string;
	duration_ms: number;
	status: string;
	target_description?: string;
	spec_name: string;
	context: string;
};

/**
 * Logs a performance metric to the configured endpoint
 *
 * @param metric The performance metric to log
 * @param isElectronApp Whether the metric is from an Electron app
 * @param logger Logger for recording status and debugging information
 * @returns Response with status code and message
 */
export async function logMetric(
	metric: PerfMetric,
	isElectronApp: boolean,
	logger: MultiLogger
): Promise<MetricResponse> {
	if (process.env.CI && !CONNECT_API_KEY) {
		logger.log('Missing CONNECT_API_KEY. Skipping metric logging.');
		return {
			statusCode: 0,
			ok: false,
			body: 'No API key configured'
		};
	}

	// Determine the API URL based on the branch
	const branch =
		process.env.GITHUB_HEAD_REF || // PRs
		process.env.GITHUB_REF_NAME;   // Push, dispatch, etc.

	const apiUrl = branch === 'main' ? PROD_API_URL : LOCAL_API_URL;
	const payload = createMetricPayload(metric, isElectronApp);

	logger.log(`--- Log Metric ---`);
	logger.log(`Current branch: ${branch || 'unknown'}`);
	logger.log(`Metric: ${payload.feature_area} > ${payload.action} > ${payload.target_type}`);
	logger.log(`Request: ${apiUrl}\n${JSON.stringify(payload, null, 2)}`);

	return sendMetricRequest(apiUrl, payload, logger);
}

/**
 * Creates a metric payload from the provided metric data
 */
function createMetricPayload(metric: PerfMetric, isElectronApp: boolean): MetricPayload {
	const {
		feature_area,
		action,
		target_type,
		target_description,
		duration_ms,
		status = 'success',
		context_json = {},
		spec_name
	} = metric;

	return {
		timestamp: new Date().toISOString(),
		platform_os: platformOs,
		platform_version: platformVersion,
		app_version: positronVersion?.positronVersion || 'unknown',
		build_number: positronVersion?.buildNumber || 'unknown',
		runtime_env: isElectronApp ? 'electron' : 'chromium',
		run_id: process.env.GITHUB_RUN_ID ?? process.env.RUN_ID ?? 'unknown',
		feature_area,
		action,
		target_type,
		duration_ms,
		status,
		target_description,
		spec_name: spec_name || SPEC_NAME,
		context: JSON.stringify(context_json)
	};
}

/**
 * Sends the metric request to the API endpoint
 */
async function sendMetricRequest(
	apiUrl: string,
	payload: MetricPayload,
	logger: MultiLogger
): Promise<MetricResponse> {
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
		logger.log(`Response: ${responseBody}`);

		return {
			statusCode: response.statusCode,
			ok: response.statusCode < 400,
			body: responseBody
		};
	} catch (error) {
		return handleRequestError(error, apiUrl, logger);
	}
}

/**
 * Handles errors from the API request
 */
function handleRequestError(error: unknown, apiUrl: string, logger: MultiLogger): MetricResponse {
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
