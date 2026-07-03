/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { GET_GUIDANCE_TOOL, getGuidance, POSITRON_MCP_GUIDES } from '../../common/positronMcpGuides.js';

describe('positronMcp guides', () => {
	it('serves each catalogued guide body', () => {
		for (const guide of POSITRON_MCP_GUIDES) {
			const result = getGuidance({ topic: guide.topic });
			expect(result.isError).toBeUndefined();
			expect(result.content).toEqual([{ type: 'text', text: guide.body }]);
		}
	});

	it('returns a tool error naming the valid topics for an unknown topic', () => {
		const result = getGuidance({ topic: 'no-such-guide' });
		expect(result.isError).toBe(true);
		const text = (result.content[0] as { text: string }).text;
		expect(text).toContain('"no-such-guide"');
		expect(text).toContain('data-analysis-r');
		expect(text).toContain('data-analysis-python');
	});

	it('carries the catalog in the tool description and schema enum', () => {
		const schema = GET_GUIDANCE_TOOL.inputSchema as { properties: { topic: { enum: string[] } } };
		expect(schema.properties.topic.enum).toEqual(POSITRON_MCP_GUIDES.map(guide => guide.topic));
		for (const guide of POSITRON_MCP_GUIDES) {
			expect(GET_GUIDANCE_TOOL.description).toContain(`- ${guide.topic}: ${guide.summary}`);
		}
	});

	it('keeps the guide bodies ASCII-only and pointed at core tool names', () => {
		for (const guide of POSITRON_MCP_GUIDES) {
			// The repo bans unicode punctuation; the port must not reintroduce it.
			expect(guide.body).toMatch(/^[\x09\x0A\x20-\x7E]*$/);
			// The assistant skills said `executeCode`; core's tool is execute-code.
			expect(guide.body).not.toContain('executeCode');
			expect(guide.body).toContain('`execute-code`');
		}
	});
});
