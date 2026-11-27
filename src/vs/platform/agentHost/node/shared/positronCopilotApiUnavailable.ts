/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Stand-ins for the two runtime values `copilotApiService.ts` takes from
 * `@vscode/copilot-api`. Positron does not ship that package (its license
 * doesn't allow it), so the agent host imports only its types, and these
 * values take the place of the real ones.
 *
 * Constructing a {@link CAPIClient} throws. `CopilotApiService` builds its
 * client lazily, on the first request for a token, so every Copilot API call
 * (model listing, the Claude proxy, utility completions) fails with this error
 * before it reaches the network, and callers handle it as they would any other
 * Copilot API failure.
 */

import type * as copilotApi from '@vscode/copilot-api';

export type CAPIClient = copilotApi.CAPIClient;
export type RequestType = copilotApi.RequestType;

/** The message of the error every Copilot API request fails with in Positron. */
export const COPILOT_API_UNAVAILABLE_MESSAGE = 'The GitHub Copilot API is not available in Positron.';

/**
 * Throws on construction, so no request is ever made.
 */
export const CAPIClient = class {
	constructor() {
		throw new Error(COPILOT_API_UNAVAILABLE_MESSAGE);
	}
} as unknown as typeof copilotApi.CAPIClient;

/**
 * Each member of the package's string enum has its own name as its value, so
 * echo the key back. Only read when building a request, which the throwing
 * {@link CAPIClient} prevents, but kept accurate for the log lines that
 * mention a request type.
 */
export const RequestType = new Proxy({}, {
	get: (_target, key) => key,
}) as typeof copilotApi.RequestType;
