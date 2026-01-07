/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Common types and interfaces for model providers.
 *
 * This module defines shared type definitions used across all model provider
 * implementations in the Positron Assistant extension. These types provide
 * a consistent structure for describing model capabilities, provider metadata,
 * token usage, and configuration options.
 *
 * @module modelProviderTypes
 */

/**
 * Model capabilities that can be supported by a provider.
 */
export interface ModelCapabilities extends vscode.LanguageModelChatCapabilities {
	/**
	 * Whether the model supports agent mode.
	 */
	agentMode?: boolean;
}

/**
 * Provider metadata for tracking and analytics.
 */
export interface ProviderMetadata {
	/**
	 * The provider ID.
	 */
	providerId: string;

	/**
	 * The provider display name.
	 */
	providerName: string;

	/**
	 * The provider version.
	 */
	version?: string;

	/**
	 * Custom metadata specific to the provider.
	 */
	custom?: Record<string, any>;
}

/**
 * Model information extended with provider-specific details.
 */
export interface ExtendedModelInfo extends vscode.LanguageModelChatInformation {
	/**
	 * Provider-specific metadata.
	 */
	providerMetadata?: ProviderMetadata;

	/**
	 * Model-specific capabilities (required by base interface).
	 */
	capabilities: ModelCapabilities;

	/**
	 * Whether this is the default model for the provider.
	 */
	isDefault?: boolean;

	/**
	 * Model tags for categorization.
	 */
	tags?: string[];

	/**
	 * Model deprecation status.
	 */
	deprecated?: boolean;

	/**
	 * Model deprecation message.
	 */
	deprecationMessage?: string;
}

/**
 * Provider autoconfiguration result.
 */
export interface AutoconfigureResult {
	/**
	 * Whether autoconfiguration was successful.
	 */
	configured: boolean;

	/**
	 * Optional message describing the result.
	 */
	message?: string;

	/**
	 * Configuration values that were set.
	 */
	configuration?: Record<string, any>;
}

/**
 * Provider connection test result.
 */
export interface ConnectionTestResult {
	/**
	 * Whether the connection test was successful.
	 */
	success: boolean;

	/**
	 * The model that was successfully connected to.
	 */
	model?: string;

	/**
	 * Error message if the test failed.
	 */
	error?: string;

	/**
	 * Response time in milliseconds.
	 */
	responseTime?: number;
}

/**
 * Model filter criteria.
 */
export interface ModelFilter {
	/**
	 * Filter by model family.
	 */
	family?: string;

	/**
	 * Filter by capabilities.
	 */
	capabilities?: Partial<ModelCapabilities>;

	/**
	 * Filter by tags.
	 */
	tags?: string[];

	/**
	 * Exclude deprecated models.
	 */
	excludeDeprecated?: boolean;

	/**
	 * Custom filter function.
	 */
	customFilter?: (model: ExtendedModelInfo) => boolean;
}

/**
 * Provider initialization options.
 */
export interface ProviderInitOptions {
	/**
	 * Whether to validate credentials on initialization.
	 */
	validateCredentials?: boolean;

	/**
	 * Whether to fetch models on initialization.
	 */
	fetchModels?: boolean;

	/**
	 * Timeout for initialization operations in milliseconds.
	 */
	timeout?: number;

	/**
	 * Custom logger instance.
	 */
	logger?: any;
}

/**
 * Token usage information with provider-specific details.
 */
export interface ExtendedTokenUsage {
	/**
	 * Number of input tokens.
	 */
	inputTokens: number;

	/**
	 * Number of output tokens.
	 */
	outputTokens: number;

	/**
	 * Number of cached tokens.
	 */
	cachedTokens?: number;

	/**
	 * Total tokens (input + output).
	 */
	totalTokens?: number;

	/**
	 * Cost estimation if available.
	 */
	estimatedCost?: {
		input: number;
		output: number;
		total: number;
		currency: string;
	};

	/**
	 * Provider-specific metadata.
	 */
	providerMetadata?: any;
}
