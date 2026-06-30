/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IMcpCallToolResult, McpContent } from '../../../../platform/positronMcp/common/positronMcpTools.js';

/** Cap on a single text tool result, matching the extension's 8KB limit. */
export const MAX_OUTPUT_LENGTH = 8 * 1024;

/** Truncate long text output with a trailing marker, as the extension did. */
export function truncateOutput(text: string): string {
	return text.length > MAX_OUTPUT_LENGTH
		? text.slice(0, MAX_OUTPUT_LENGTH) + '\n\n[output truncated]'
		: text;
}

/** Wrap plain text as a successful MCP tool result, truncating long output. */
export function textResult(text: string): IMcpCallToolResult {
	const content: McpContent[] = [{ type: 'text', text: truncateOutput(text) }];
	return { content };
}
