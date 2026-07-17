/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, suite, test } from 'vitest';
import { PositronAssistant } from '../positronAssistant';

suite('PositronAssistant', () => {
	const request = { prompt: 'hello' };
	const element = new PositronAssistant({ promptContext: { request } } as any);

	test('prepare returns undefined when there is no chat request', async () => {
		const withoutRequest = new PositronAssistant({ promptContext: {} } as any);

		expect(await withoutRequest.prepare({} as any)).toBeUndefined();
	});

	test('prepare returns undefined when the Positron API is unavailable', async () => {
		// The `positron` module is provided by the Positron extension host at
		// runtime and is not resolvable here, so prepare degrades gracefully
		// rather than failing the chat request. (The prompt-generation itself is
		// exercised by the core positron.ai.generateAssistantPrompt tests.)
		expect(await element.prepare({} as any)).toBeUndefined();
	});

	test('render returns nothing when there is no Positron context', () => {
		expect(element.render(undefined, {} as any)).toBeUndefined();
	});

	test('render embeds the Positron context when it is available', () => {
		const rendered = element.render('positron context', {} as any);

		expect(JSON.stringify(rendered)).toContain('positron context');
	});
});
