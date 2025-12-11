/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Main export file for all model providers.
 * This file aggregates exports from all provider implementations
 * to maintain backward compatibility during the refactoring.
 */

// Base classes and utilities
export { ModelProvider, AutoconfigureResult } from './base/modelProvider';
export { ModelProviderLogger } from './base/modelProviderLogger';
export * from './base/modelProviderErrors';
export * from './base/modelProviderTypes';

// Test providers
export { ErrorLanguageModel } from './test/errorProvider';
export { EchoLanguageModel } from './test/echoProvider';

// OpenAI providers
export { OpenAILanguageModel } from './openai/openaiProvider';
export { OpenAICompatibleLanguageModel } from './openai/openaiCompatibleProvider';

// Anthropic providers
export { AnthropicAILanguageModel } from './anthropic/anthropicAIProvider';
// Note: AnthropicLanguageModel (native SDK version) remains in anthropic.ts

// Cloud providers
export { AzureLanguageModel } from './azure/azureProvider';
export { GoogleLanguageModel } from './google/googleProvider';
export { VertexLanguageModel } from './google/vertexProvider';
export { SnowflakeLanguageModel } from './snowflake/snowflakeProvider';

// Other providers
export { MistralLanguageModel } from './mistral/mistralProvider';
export { OllamaLanguageModel } from './ollama/ollamaProvider';
export { OpenRouterLanguageModel } from './openrouter/openrouterProvider';

// AWS providers
export { AWSLanguageModel } from './aws/awsBedrockProvider';