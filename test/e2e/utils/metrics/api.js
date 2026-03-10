"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.logMetric = logMetric;
const undici_1 = require("undici");
const metric_base_js_1 = require("./metric-base.js");
const constants_js_1 = require("../../fixtures/test-setup/constants.js");
/**
 * Logs a performance metric to the configured endpoint
 *
 * @param metric The performance metric to log
 * @param isElectronApp Whether the metric is from an Electron app
 * @param logger Logger for recording status and debugging information
 * @returns Response with status code and message
 */
async function logMetric(metric, isElectronApp, logger) {
    if (process.env.CI && !metric_base_js_1.CONNECT_API_KEY) {
        logger.log('Missing CONNECT_API_KEY. Skipping metric logging.');
        return {
            statusCode: 0,
            ok: false,
            body: 'No API key configured'
        };
    }
    // Determine the API URL based on the branch
    const branch = process.env.GITHUB_HEAD_REF || // PRs
        process.env.GITHUB_REF_NAME; // Push, dispatch, etc.
    const apiUrl = branch === 'main' ? metric_base_js_1.PROD_API_URL : metric_base_js_1.LOCAL_API_URL;
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
function createMetricPayload(metric, isElectronApp) {
    const { feature_area, action, target_type, target_description, duration_ms, status = 'success', context_json = {}, spec_name } = metric;
    return {
        timestamp: new Date().toISOString(),
        platform_os: metric_base_js_1.platformOs,
        platform_version: metric_base_js_1.platformVersion,
        app_version: metric_base_js_1.positronVersion?.positronVersion ?? 'unknown',
        build_number: String(metric_base_js_1.positronVersion?.buildNumber ?? 'unknown'),
        runtime_env: isElectronApp ? 'electron' : 'chromium',
        run_id: process.env.GITHUB_RUN_ID ?? process.env.RUN_ID ?? 'unknown',
        feature_area,
        action,
        target_type,
        duration_ms,
        status,
        target_description,
        spec_name: spec_name || constants_js_1.SPEC_NAME,
        context: JSON.stringify(context_json)
    };
}
/**
 * Sends the metric request to the API endpoint
 */
async function sendMetricRequest(apiUrl, payload, logger) {
    try {
        const response = await (0, undici_1.request)(apiUrl, {
            method: 'POST',
            headers: {
                Authorization: `Key ${metric_base_js_1.CONNECT_API_KEY}`,
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
    }
    catch (error) {
        return handleRequestError(error, apiUrl, logger);
    }
}
/**
 * Handles errors from the API request
 */
function handleRequestError(error, apiUrl, logger) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorCode = error instanceof Error && 'code' in error ?
        error.code : 'No code';
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
//# sourceMappingURL=api.js.map