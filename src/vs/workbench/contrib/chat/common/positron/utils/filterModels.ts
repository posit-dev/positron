/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { match } from '../../../../../../base/common/glob.js';

/**
 * Pattern matching for model filters. Supports both explicit glob patterns
 * and simple model name matching across multiple fields.
 */
export function matchesModelFilter(pattern: string, identifier: string, id: string, name: string): boolean {
	const normalizedPattern = pattern.toLowerCase().trim();
	const values = [identifier, id, name].map(v => v.toLowerCase());

	// If pattern contains wildcards, use as-is (for power users using glob patterns)
	if (normalizedPattern.includes('*')) {
		return values.some(value => match(normalizedPattern, value));
	}

	// Smart matching for simple model names
	return values.some(value => {
		// Direct substring match (handles "gpt" matching "gpt-4o")
		if (value.includes(normalizedPattern)) { return true; }

		// Path-aware matching (handles "gpt" matching "openai/gpt-5")
		const pathParts = value.split(/[\/\-]/);
		if (pathParts.some(part => part.includes(normalizedPattern))) { return true; }

		// Word boundary matching (handles "claude" matching "Claude Opus 4")
		const words = value.split(/[\s\-\/]/);
		if (words.some(word => word.includes(normalizedPattern))) { return true; }

		return false;
	});
}
