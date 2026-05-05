/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from 'vscode-languageclient';

import type { SubmitCompletionFeedbackParams, SubmitCompletionFeedbackResponse } from './types.js';
import { getLanguageClientManager } from './client.js';
import { getLLMConfiguration } from './model.js';
import { log } from './extension.js';

const submitCompletionFeedbackRequestType = new RequestType<
	SubmitCompletionFeedbackParams,
	SubmitCompletionFeedbackResponse,
	void
>('supercomplete/submitCompletionFeedback');

export function sendFeedback(
	correlationId: string | undefined,
	feedback: SubmitCompletionFeedbackParams['feedback'],
): void {
	log.debug(`[feedback] ${feedback}${correlationId ? ` (${correlationId})` : ''}`);

	const clientManager = getLanguageClientManager();
	if (!clientManager || !correlationId) {
		return;
	}

	void getLLMConfiguration().then((llmConfig) => {
		if (!llmConfig) {
			return;
		}
		clientManager.client
			.sendRequest(submitCompletionFeedbackRequestType, {
				correlationId,
				feedback,
				llmConfig,
			})
			.catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				log.warn(`Failed to submit completion feedback: ${message}`);
			});
	});
}
