/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from 'sinon';
import type { LanguageServerClientManager } from '../client.js';
import type { InlineEditResult, LLMConfig } from '../types.js';

/**
 * A fake LSP client manager whose `client.sendRequest` is a Sinon stub. Used to
 * mock the vendored language server's request/response surface without starting
 * a real server process.
 */
export interface FakeClientManager {
	manager: LanguageServerClientManager;
	sendRequest: sinon.SinonStub;
}

export function makeFakeClientManager(): FakeClientManager {
	const sendRequest = sinon.stub();
	// eslint-disable-next-line local/code-no-dangerous-type-assertions
	const manager = {
		client: { sendRequest },
		dispose() { },
	} as unknown as LanguageServerClientManager;
	return { manager, sendRequest };
}

export function makeLLMConfig(overrides: Partial<LLMConfig> = {}): LLMConfig {
	return {
		providerDisplayName: 'Test Provider',
		modelId: 'qwen3-8b',
		endpointPath: '/completions/qwen3-8b/predict',
		accessToken: 'test-token',
		baseUrl: 'https://gateway.example.test',
		maxContextTokens: 5000,
		maxOutputTokens: 256,
		options: { userAgent: 'test-agent' },
		...overrides,
	};
}

export function makeInlineEditResult(opts: {
	text: string;
	range: { start: { line: number; character: number }; end: { line: number; character: number } };
	correlationId?: string;
}): InlineEditResult {
	return {
		edits: [{ text: opts.text, range: opts.range }],
		correlationId: opts.correlationId,
	};
}
