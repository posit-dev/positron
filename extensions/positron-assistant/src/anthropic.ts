/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * @deprecated This file is deprecated. Use AnthropicLanguageModel and related exports from ./providers/anthropic/anthropicProvider instead.
 * This re-export will be removed in a future version.
 *
 * Migration guide:
 * - Change: `import { AnthropicLanguageModel } from './anthropic'`
 * - To: `import { AnthropicLanguageModel } from './providers/anthropic/anthropicProvider'`
 */

export {
	AnthropicLanguageModel,
	toTokenUsage,
	toAnthropicMessages,
	toAnthropicSystem,
	toAnthropicTools,
	toAnthropicToolChoice,
	isCacheControlOptions,
	DEFAULT_ANTHROPIC_MODEL_NAME,
	DEFAULT_ANTHROPIC_MODEL_MATCH,
	type CacheControlOptions,
} from './providers/anthropic/anthropicProvider';
