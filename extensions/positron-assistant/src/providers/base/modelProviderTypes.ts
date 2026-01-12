/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
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
