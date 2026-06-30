/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export interface LLMConfig {
	providerDisplayName: string;
	modelId: string;
	modelDisplayName?: string;
	apiKey?: string;
	accessToken?: string;
	baseUrl?: string;
	endpointPath?: string;
	maxContextTokens: number;
	maxOutputTokens: number;
	options: {
		userAgent: string;
	};
}

export const CompletionTriggerKind = {
	Invoked: 1,
	TriggerCharacter: 2,
	TriggerForIncompleteCompletions: 3,
} as const;
export type CompletionTriggerKind = (typeof CompletionTriggerKind)[keyof typeof CompletionTriggerKind];

export interface InlineEditSelection {
	excerpt: string;
	editableRegionStart: { line: number; character: number };
	editableRegionEnd: { line: number; character: number };
}

export interface InlineEditParams {
	textDocument: { uri: string };
	position: { line: number; character: number };
	context: {
		triggerKind: CompletionTriggerKind;
	};
	selection?: InlineEditSelection;
	variables?: VariablesContext[];
	llmConfig: LLMConfig;
}

export interface InlineEditResult {
	edits: Array<{
		text: string;
		range: {
			start: { line: number; character: number };
			end: { line: number; character: number };
		};
		command?: {
			title: string;
			command: string;
			arguments: string[];
		};
	}>;
	editHistory?: Array<{
		uri: string;
		timestamp: number;
		diff: string;
	}>;
	correlationId?: string;
}

export interface SubmitCompletionFeedbackParams {
	correlationId: string;
	feedback: 'accepted' | 'rejected' | 'ignored' | 'filtered';
	llmConfig: LLMConfig;
}

export interface SubmitCompletionFeedbackResponse {
	success: boolean;
}

export interface Variable {
	name: string;
	type: string;
	children?: Variable[];
}

export interface VariablesContext {
	languageId: string;
	variables: Variable[];
}

export interface CompletionModel {
	id: string;
	displayName: string;
	endpointPath: string;
	protocol: string;
	weight: number;
}

export interface ModelsResponseEndpoint {
	path: string;
	protocol: string;
}

export interface ModelsResponseCompletionModel {
	id: string;
	display_name: string;
	endpoints: ModelsResponseEndpoint[];
	weight: number;
}

export interface ModelsResponse {
	completions?: ModelsResponseCompletionModel[];
}
