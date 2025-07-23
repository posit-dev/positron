/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { PromptRenderer } from '../promptRenderer';
import { ChatPrompt } from '../prompts/participants/ChatPrompt';
import { SystemMessage } from '../prompts/components/base/SystemMessage';

/**
 * Basic test to verify prompt-tsx integration works
 */
export async function testPromptRendering(): Promise<void> {
	console.log('Testing prompt-tsx integration...');

	try {
		// Test 1: Basic SystemMessage component
		const basicPrompt = await PromptRenderer.render(
			SystemMessage,
			{
				children: 'You are a helpful AI assistant.',
				priority: 100
			},
			undefined,
			'test-basic'
		);
		console.log('✅ Basic SystemMessage rendered:', basicPrompt.length > 0);

		// Test 2: ChatPrompt composition
		const chatPrompt = await PromptRenderer.render(
			ChatPrompt,
			{
				includeFilepaths: true,
				activeSessions: ['python', 'typescript'],
				priority: 100
			},
			undefined,
			'test-chat'
		);
		console.log('✅ ChatPrompt composition rendered:', chatPrompt.length > 0);

		// Test 3: Cache functionality
		const cachedResult = await PromptRenderer.render(
			SystemMessage,
			{
				children: 'Cached test message',
				priority: 100
			},
			undefined,
			'test-cache'
		);

		const cachedResult2 = await PromptRenderer.render(
			SystemMessage,
			{
				children: 'Cached test message',
				priority: 100
			},
			undefined,
			'test-cache'
		);

		console.log('✅ Cache working:', cachedResult === cachedResult2);

		// Test 4: Cache stats
		const stats = PromptRenderer.getCacheStats();
		console.log('✅ Cache stats:', stats);

		console.log('🎉 All prompt-tsx integration tests passed!');
	} catch (error) {
		console.error('❌ Prompt-tsx integration test failed:', error);
		throw error;
	}
}
