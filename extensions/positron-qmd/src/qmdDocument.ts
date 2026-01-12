/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export interface QmdBlock {
	t: string; // Block type (e.g., 'Header', 'CodeBlock', 'Para')
	c: unknown; // Block content (structure varies by type)
	s: number; // Source info index
	attrS?: {
		id: string | null;
		classes: unknown[];
		kvs: unknown[];
	};
}

export interface QmdDocument {
	meta: Record<string, unknown>;
	blocks: QmdBlock[];
	'pandoc-api-version': number[];
	astContext: {
		files: unknown[];
		metaTopLevelKeySources: Record<string, number>;
		sourceInfoPool: unknown[];
	};
}
