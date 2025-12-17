/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as ai from 'ai';
import * as vscode from 'vscode';

// -----------------------------------------------------------------
// Request Options
// -----------------------------------------------------------------

/**
 * Options for LLM generation requests.
 * Accepts AI SDK v5 message and tool formats.
 */
export interface LLMRequestOptions {
	/**
	 * Model identifier in canonical format: "provider/model"
	 * Examples: "anthropic-api/claude-sonnet-4", "copilot/gpt-4o"
	 *
	 * Also accepts raw model IDs for convenience (e.g., "claude-sonnet-4"),
	 * which will be resolved against registered models.
	 *
	 * If not provided, uses the default model.
	 */
	model?: string;

	/**
	 * Messages in AI SDK v5 format.
	 */
	messages: ai.ModelMessage[];

	/**
	 * Tool definitions. Can be:
	 * - AI SDK tools created with ai.tool() (Zod schemas will be converted)
	 * - Plain objects with JSON Schema inputSchema
	 */
	tools?: Record<string, ai.Tool>;

	/**
	 * Maximum output tokens.
	 */
	maxTokens?: number;

	/**
	 * Temperature (0-2).
	 */
	temperature?: number;

	/**
	 * Abort signal for cancellation.
	 */
	abortSignal?: AbortSignal;

	/**
	 * Max steps for tool calling loops.
	 */
	maxSteps?: number;
}

// -----------------------------------------------------------------
// Result Types (Mirror AI SDK v5 exactly)
// -----------------------------------------------------------------

/**
 * Streaming result type. Mirrors AI SDK v5 streamText() return type.
 *
 * For AI SDK models, this IS the AI SDK result (no adaptation).
 * For Copilot models, this is adapted from vscode.lm response.
 */
export interface UnifiedStreamResult {
	/** Stream of text chunks only */
	textStream: AsyncIterable<string>;

	/** Full stream including text, tool calls, and other events */
	fullStream: AsyncIterable<UnifiedStreamPart>;

	/** Promise resolving to the complete text */
	text: Promise<string>;

	/** Promise resolving to all tool calls made */
	toolCalls: Promise<UnifiedToolCall[]>;

	/** Promise resolving to token usage */
	usage: Promise<UnifiedUsage>;
}

/**
 * Stream part types. Mirrors AI SDK v5 StreamPart union.
 * Note: Field names match AI SDK exactly (textDelta, args, not text, input).
 */
export type UnifiedStreamPart =
	| { type: 'text-delta'; textDelta: string }
	| { type: 'tool-call'; toolCallId: string; toolName: string; args: unknown }
	| { type: 'tool-result'; toolCallId: string; toolName: string; result: unknown }
	| { type: 'step-finish'; finishReason: FinishReason; usage: UnifiedUsage }
	| { type: 'finish'; finishReason: FinishReason; usage: UnifiedUsage }
	| { type: 'error'; error: unknown };

export type FinishReason = 'stop' | 'length' | 'tool-calls' | 'content-filter' | 'error' | 'unknown';

export interface UnifiedToolCall {
	toolCallId: string;
	toolName: string;
	args: unknown;  // Note: "args" not "input" to match AI SDK
}

export interface UnifiedUsage {
	inputTokens: number;
	outputTokens: number;
}

export interface UnifiedGenerateResult {
	text: string;
	toolCalls: UnifiedToolCall[];
	usage: UnifiedUsage;
	finishReason: FinishReason;
}

// -----------------------------------------------------------------
// Model & Provider Info
// -----------------------------------------------------------------

export interface ModelInfo {
	/**
	 * Canonical model identifier in "provider/model" format.
	 * Examples: "anthropic-api/claude-sonnet-4", "copilot/gpt-4o"
	 */
	id: string;

	/** Human-readable model name */
	name: string;

	/** Provider ID (e.g., 'anthropic-api', 'copilot') */
	provider: string;

	/** Human-readable provider name */
	providerDisplayName: string;

	/** Whether this is a Copilot model (routed through vscode.lm) */
	isCopilot: boolean;

	/** Max input tokens, if known */
	maxInputTokens?: number;

	/** Max output tokens, if known */
	maxOutputTokens?: number;
}

export interface ProviderInfo {
	/** Provider ID */
	id: string;

	/** Human-readable provider name */
	displayName: string;

	/** Whether the provider is configured/available */
	isConfigured: boolean;

	/** Number of models available from this provider */
	modelCount: number;
}

// -----------------------------------------------------------------
// Main API Interface
// -----------------------------------------------------------------

/**
 * Unified LLM API for Positron extensions.
 *
 * This API provides a consistent interface regardless of whether the
 * underlying model is from Anthropic, Posit AI, Copilot, or another provider.
 */
export interface PositronLLMApi {
	/**
	 * Stream text from a language model.
	 *
	 * For non-Copilot models, routes directly to AI SDK v5 and returns as-is.
	 * For Copilot models, routes through vscode.lm with format adaptation.
	 */
	streamText(options: LLMRequestOptions): Promise<UnifiedStreamResult>;

	/**
	 * Generate text from a language model (non-streaming).
	 */
	generateText(options: LLMRequestOptions): Promise<UnifiedGenerateResult>;

	/**
	 * Get all available models from all configured providers.
	 * Model IDs are in canonical "provider/model" format.
	 */
	getAvailableModels(): Promise<ModelInfo[]>;

	/**
	 * Get all configured providers.
	 */
	getAvailableProviders(): Promise<ProviderInfo[]>;

	/**
	 * Event fired when available models change.
	 * Fires for both Copilot model changes and Positron config changes.
	 */
	onModelsChanged: vscode.Event<void>;
}
