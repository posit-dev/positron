/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { isWeb } from '../../../base/common/platform.js';

/** Name of the injected global that marks a browser session SageMaker-hosted. */
export const POSITRON_IS_SAGEMAKER_GLOBAL = '_POSITRON_IS_SAGEMAKER';

let sageMakerSession = false;

/**
 * Records a `sagemaker` license kind. Called from server startup once the license validates,
 * before any request is served.
 */
export function markSageMakerSession(): void {
	sageMakerSession = true;
}

/**
 * Whether this Positron deployment is hosted on Amazon SageMaker.
 *
 * Node/server: set by {@link markSageMakerSession}. Browser: read from the global injected by
 * `webClientServer.ts`. Desktop: always false, since desktop skips the license check.
 */
export function isSageMakerSession(): boolean {
	return isWeb
		? (globalThis as Record<string, unknown>)[POSITRON_IS_SAGEMAKER_GLOBAL] === true
		: sageMakerSession;
}

/**
 * Builds the inline `<script>` that carries {@link isSageMakerSession} to the browser, for
 * injection into the served workbench HTML. Empty when false: an absent global reads as false.
 */
export function sageMakerMarkerScript(isSageMaker: boolean): string {
	return isSageMaker ? `<script>globalThis.${POSITRON_IS_SAGEMAKER_GLOBAL} = true;</script>` : '';
}
