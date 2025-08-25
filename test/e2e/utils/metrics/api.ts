/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { request } from 'undici';
import { MultiLogger } from '../../infra/logger.js';
import { CONNECT_API_KEY, PROD_API_URL, LOCAL_API_URL, platformOs, platformVersion, MetricResponse } from './metric-base.js';
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
	context_json = {},
	spec_name
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
		spec_name: spec_name || SPEC_NAME,  // Use provided spec_name or fall back to global SPEC_NAME
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
