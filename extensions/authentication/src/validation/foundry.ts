/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Normalize a user-provided Foundry URL to the v1 API base.
 * Handles deployment URLs, query parameters, and trailing slashes.
 */
export function normalizeToV1Url(rawUrl: string): string {
	let url = rawUrl.trim();
	if (!url) {
		return '';
	}
	const queryIndex = url.indexOf('?');
	if (queryIndex !== -1) {
		url = url.substring(0, queryIndex);
	}
	url = url.replace(/\/+$/, '');
	if (!url) {
		return '';
	}
	const deploymentIndex = url.indexOf('/openai/deployments/');
	if (deploymentIndex !== -1) {
		url = url.substring(0, deploymentIndex);
	}
	if (!url.endsWith('/openai/v1')) {
		url += '/openai/v1';
	}
	return url;
}
