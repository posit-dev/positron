/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const IPositronLMService = createDecorator<IPositronLMService>('positronLMService');

// --- Model selection ---

export type ModelTier = 'fast-cheap';

export type ModelSelection =
	| { tier: ModelTier }
	| { id: string }
	| { patterns: string[] };

export const FastCheap: ModelSelection = { tier: 'fast-cheap' };

/**
 * Configuration key backing each model tier. Adding a tier to `ModelTier`
 * forces an entry here, keeping the resolver and the config contribution in sync.
 */
export const TIER_SETTING_KEYS: Record<ModelTier, string> = {
	'fast-cheap': 'languageModels.fastcheap',
};

/** Default fast-cheap preference patterns, shared by the config contribution and the resolver fallback. */
export const FAST_CHEAP_DEFAULT_PATTERNS: readonly string[] = ['haiku', 'mini', 'flash'];

// --- Stream result ---

export type StreamFailure = 'no-providers' | 'no-match' | 'auth-required';

export type StreamResult =
	| { stream: AsyncIterable<string>; modelName: string }
	| { failure: StreamFailure };

// --- Available models ---

export interface IAvailableModel {
	id: string;
	name: string;
	providerId: string;
	providerName: string;
}

// --- Public consumer interface ---

export interface IStreamTextParams {
	systemPrompt: string;
	messages: Array<{ role: 'user' | 'assistant'; content: string }>;
	cancellationToken?: CancellationToken;
	model?: ModelSelection;
}

export interface IPositronLMService {
	readonly _serviceBrand: undefined;
	streamText(params: IStreamTextParams): Promise<StreamResult>;
	readonly availableModels: IAvailableModel[];
	readonly onDidChangeAvailableModels: Event<IAvailableModel[]>;
}

// --- IPC protocol types (shared between renderer and shared process) ---

export const POSITRON_LM_CHANNEL_NAME = 'positronLM';

export type IpcCredentials =
	| { type: 'apikey'; apiKey: string; baseUrl?: string; customHeaders?: Record<string, string> }
	| { type: 'oauth'; accessToken: string }
	| { type: 'aws-credentials'; region: string; accessKeyId: string; secretAccessKey: string; sessionToken?: string };

export interface IpcModelInfo {
	id: string;
	name?: string;
	providerId: string;
}

export interface IpcGetModelsArgs {
	providerId: string;
	credentials: IpcCredentials;
}

export interface IpcStreamTextArgs {
	providerId: string;
	credentials: IpcCredentials;
	modelId: string;
	systemPrompt: string;
	messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

/**
 * Stream events sent over IPC. Each event is a discriminated object so that
 * text chunks containing the literal string "end" are never confused with
 * the completion sentinel.
 */
export type IpcStreamEvent =
	| { type: 'data'; text: string }
	| { type: 'end' }
	| { type: 'error'; message: string };
