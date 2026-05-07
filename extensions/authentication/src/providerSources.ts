/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import {
	ANTHROPIC_AUTH_PROVIDER_ID,
	AWS_AUTH_PROVIDER_ID,
	CUSTOM_PROVIDER_AUTH_PROVIDER_ID,
	FOUNDRY_AUTH_PROVIDER_ID,
	GEMINI_AUTH_PROVIDER_ID,
	OPENAI_AUTH_PROVIDER_ID,
	POSIT_AUTH_PROVIDER_ID,
} from './constants';
import { getSnowflakeDefaultBaseUrl } from './snowflakeCredentials';

function getSavedBaseUrl(configSection: string, fallback?: string): string | undefined {
	return vscode.workspace
		.getConfiguration(`authentication.${configSection}`)
		.get<string>('baseUrl') || fallback;
}

export interface ProviderMetadata {
	id: string;
	displayName: string;
	settingName: string;
}

export const PROVIDER_METADATA: Record<string, ProviderMetadata> = {
	anthropic: {
		id: ANTHROPIC_AUTH_PROVIDER_ID,
		displayName: 'Anthropic',
		settingName: 'anthropic',
	},
	positAI: {
		id: POSIT_AUTH_PROVIDER_ID,
		displayName: 'Posit AI',
		settingName: 'positAI',
	},
	amazonBedrock: {
		id: AWS_AUTH_PROVIDER_ID,
		displayName: 'Amazon Bedrock',
		settingName: 'amazonBedrock',
	},
	foundry: {
		id: FOUNDRY_AUTH_PROVIDER_ID,
		displayName: 'Microsoft Foundry',
		settingName: 'msFoundry',
	},
	snowflake: {
		id: 'snowflake-cortex',
		displayName: 'Snowflake Cortex',
		settingName: 'snowflakeCortex',
	},
	openai: {
		id: OPENAI_AUTH_PROVIDER_ID,
		displayName: 'OpenAI',
		settingName: 'openAI',
	},
	google: {
		id: GEMINI_AUTH_PROVIDER_ID,
		displayName: 'Gemini Code Assist',
		settingName: 'google',
	},
	copilot: {
		id: 'copilot-auth',
		displayName: 'GitHub Copilot',
		settingName: 'githubCopilot',
	},
	customProvider: {
		id: CUSTOM_PROVIDER_AUTH_PROVIDER_ID,
		displayName: 'Custom Provider',
		settingName: 'customProvider',
	},
};

export function getProviderSources(): positron.ai.LanguageModelSource[] {
	return [
		{
			type: positron.PositronLanguageModelType.Chat,
			provider: PROVIDER_METADATA.anthropic,
			supportedOptions: ['apiKey', 'baseUrl', 'autoconfigure'],
			defaults: {
				name: 'Claude Sonnet 4',
				model: 'claude-sonnet-4-latest',
				baseUrl: getSavedBaseUrl('anthropic', 'https://api.anthropic.com'),
				toolCalls: true,
				autoconfigure: {
					type: positron.ai.LanguageModelAutoconfigureType.EnvVariable,
					key: 'ANTHROPIC_API_KEY',
					signedIn: false,
				},
			},
		},
		{
			type: positron.PositronLanguageModelType.Chat,
			provider: PROVIDER_METADATA.positAI,
			supportedOptions: ['oauth'],
			defaults: {
				name: 'Claude Sonnet 4.5',
				model: 'claude-sonnet-4-5-20250929',
				toolCalls: true,
				oauth: true,
			},
		},
		{
			type: positron.PositronLanguageModelType.Chat,
			provider: PROVIDER_METADATA.amazonBedrock,
			supportedOptions: ['toolCalls'],
			defaults: {
				name: 'Claude 4 Sonnet Bedrock',
				model: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
				toolCalls: true,
			},
		},
		{
			type: positron.PositronLanguageModelType.Chat,
			provider: PROVIDER_METADATA.foundry,
			supportedOptions: ['apiKey', 'baseUrl', 'toolCalls'],
			defaults: {
				name: 'Model Router',
				model: 'model-router',
				baseUrl: getSavedBaseUrl('foundry'),
				toolCalls: true,
			},
		},
		{
			type: positron.PositronLanguageModelType.Chat,
			provider: PROVIDER_METADATA.snowflake,
			supportedOptions: ['apiKey', 'baseUrl', 'toolCalls', 'autoconfigure'],
			defaults: {
				name: 'Snowflake Cortex',
				model: 'claude-4-sonnet',
				baseUrl: getSnowflakeDefaultBaseUrl(),
				toolCalls: true,
				autoconfigure: {
					type: positron.ai.LanguageModelAutoconfigureType.Custom,
					message: 'Automatically configured using Snowflake credentials',
					signedIn: false,
				},
			},
		},
		{
			type: positron.PositronLanguageModelType.Chat,
			provider: PROVIDER_METADATA.openai,
			supportedOptions: ['apiKey', 'baseUrl', 'toolCalls'],
			defaults: {
				name: 'OpenAI',
				model: 'openai',
				baseUrl: getSavedBaseUrl('openai-api', 'https://api.openai.com/v1'),
				toolCalls: true,
			},
		},
		{
			type: positron.PositronLanguageModelType.Chat,
			provider: PROVIDER_METADATA.google,
			supportedOptions: ['baseUrl', 'apiKey'],
			defaults: {
				name: 'Gemini 2.5 Flash',
				model: 'gemini-2.5-flash',
				baseUrl: getSavedBaseUrl('google', 'https://generativelanguage.googleapis.com/v1beta'),
				apiKey: undefined,
				toolCalls: true,
			},
		},
		{
			type: positron.PositronLanguageModelType.Chat,
			provider: PROVIDER_METADATA.copilot,
			supportedOptions: ['oauth', 'autoconfigure'],
			defaults: {
				name: 'GitHub Copilot',
				model: 'github-copilot',
				autoconfigure: {
					type: positron.ai.LanguageModelAutoconfigureType.Custom,
					message: 'the Accounts menu.',
					signedIn: false,
				},
			},
		},
		{
			type: positron.PositronLanguageModelType.Chat,
			provider: PROVIDER_METADATA.customProvider,
			supportedOptions: ['apiKey', 'baseUrl', 'toolCalls'],
			defaults: {
				name: 'Custom Provider',
				model: 'openai-compatible',
				baseUrl: getSavedBaseUrl('openai-compatible', 'https://localhost:1337/v1'),
				toolCalls: true,
			},
		},
	];
}
