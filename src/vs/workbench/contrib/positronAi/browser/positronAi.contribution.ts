/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../../nls.js';
import { IJSONSchema } from '../../../../base/common/jsonSchema.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { type ConfigurationKeyValuePairs, Extensions, IConfigurationMigrationRegistry } from '../../../common/configuration.js';

/**
 * Item schema shared by all ai.models.* settings.
 * Each provider may extend this with provider-specific properties.
 */
const baseModelItemSchema: IJSONSchema = {
	type: 'object',
	required: ['name', 'identifier'],
	properties: {
		name: {
			type: 'string',
			description: nls.localize('positron.ai.models.item.name', "Display name for the model"),
		},
		identifier: {
			type: 'string',
			description: nls.localize('positron.ai.models.item.identifier', "Model identifier for API calls"),
		},
		maxInputTokens: {
			type: 'number',
			minimum: 512,
			description: nls.localize('positron.ai.models.item.maxInputTokens', "Maximum input tokens for this model"),
		},
		maxOutputTokens: {
			type: 'number',
			minimum: 512,
			description: nls.localize('positron.ai.models.item.maxOutputTokens', "Maximum output tokens for this model"),
		},
	},
};

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'ai',
	title: nls.localize('positron.ai.title', "AI"),
	type: 'object',
	properties: {
		'ai.models.anthropic': {
			type: 'array',
			default: [],
			markdownDescription: nls.localize('positron.ai.models.anthropic', "Model overrides for the Anthropic provider.\n\nThese models are used instead of retrieving the model listing from the provider. Each entry requires a `name` (display name) and `identifier` (model ID for API calls). Optionally specify `maxInputTokens` and `maxOutputTokens`.\n\nRequires a restart to take effect."),
			items: baseModelItemSchema,
		},
		'ai.models.amazonBedrock': {
			type: 'array',
			default: [],
			markdownDescription: nls.localize('positron.ai.models.amazonBedrock', "Model overrides for the Amazon Bedrock provider.\n\nThese models are used instead of retrieving the model listing from the provider. Each entry requires a `name` (display name) and `identifier` (model ID for API calls). Optionally specify `maxInputTokens`, `maxOutputTokens`, and `promptCaching`.\n\nRequires a restart to take effect."),
			items: {
				...baseModelItemSchema,
				properties: {
					...baseModelItemSchema.properties,
					promptCaching: {
						type: 'boolean',
						description: nls.localize('positron.ai.models.item.promptCaching', "Whether this model supports prompt caching. When false, cache breakpoints are not sent to the model. Defaults to auto-detection based on the model identifier."),
					},
				},
			},
		},
		'ai.models.snowflakeCortex': {
			type: 'array',
			default: [],
			markdownDescription: nls.localize('positron.ai.models.snowflakeCortex', "Model overrides for the Snowflake Cortex provider.\n\nThese models are used instead of retrieving the model listing from the provider. Each entry requires a `name` (display name) and `identifier` (model ID for API calls). Optionally specify `maxInputTokens` and `maxOutputTokens`.\n\nRequires a restart to take effect."),
			items: baseModelItemSchema,
		},
		'ai.models.msFoundry': {
			type: 'array',
			default: [],
			markdownDescription: nls.localize('positron.ai.models.msFoundry', "Model overrides for the Microsoft Foundry provider.\n\nThese models are used instead of retrieving the model listing from the provider. Each entry requires a `name` (display name) and `identifier` (model ID for API calls). Optionally specify `maxInputTokens` and `maxOutputTokens`.\n\nRequires a restart to take effect."),
			items: baseModelItemSchema,
			tags: ['preview'],
		},
		'ai.models.openAI': {
			type: 'array',
			default: [],
			markdownDescription: nls.localize('positron.ai.models.openAI', "Model overrides for the OpenAI provider.\n\nThese models are used instead of retrieving the model listing from the provider. Each entry requires a `name` (display name) and `identifier` (model ID for API calls). Optionally specify `maxInputTokens` and `maxOutputTokens`.\n\nRequires a restart to take effect."),
			items: baseModelItemSchema,
			examples: [
				[{ name: 'GPT-4o', identifier: 'gpt-4o' }],
			],
		},
		'ai.models.customProvider': {
			type: 'array',
			default: [],
			markdownDescription: nls.localize('positron.ai.models.customProvider', "Model overrides for the Custom Provider.\n\nThese models are used instead of retrieving the model listing from the provider. Each entry requires a `name` (display name) and `identifier` (model ID for API calls). Optionally specify `maxInputTokens` and `maxOutputTokens`.\n\nRequires a restart to take effect."),
			items: baseModelItemSchema,
			tags: ['experimental'],
		},
		'ai.models.positAI': {
			type: 'array',
			default: [],
			markdownDescription: nls.localize('positron.ai.models.positAI', "Model overrides for the Posit AI provider.\n\nThese models are used instead of retrieving the model listing from the provider. Each entry requires a `name` (display name) and `identifier` (model ID for API calls). Optionally specify `maxInputTokens` and `maxOutputTokens`.\n\nRequires a restart to take effect."),
			items: baseModelItemSchema,
		},
		'ai.models.gemini': {
			type: 'array',
			default: [],
			markdownDescription: nls.localize('positron.ai.models.gemini', "Model overrides for the Google Gemini provider.\n\nThese models are used instead of retrieving the model listing from the provider. Each entry requires a `name` (display name) and `identifier` (model ID for API calls). Optionally specify `maxInputTokens` and `maxOutputTokens`.\n\nRequires a restart to take effect."),
			items: baseModelItemSchema,
			tags: ['experimental'],
		},
		'ai.models.geminiEnterprise': {
			type: 'array',
			default: [],
			markdownDescription: nls.localize('positron.ai.models.geminiEnterprise', "Model overrides for the Google Vertex AI (Gemini Enterprise) provider.\n\nThese models are used instead of retrieving the model listing from the provider. Each entry requires a `name` (display name) and `identifier` (model ID for API calls). Optionally specify `maxInputTokens` and `maxOutputTokens`.\n\nRequires a restart to take effect."),
			items: baseModelItemSchema,
			tags: ['experimental'],
		},
	},
});

/**
 * Migrate legacy positron.assistant.models.overrides.* keys to ai.models.*.
 * This runs at startup before any extension reads the settings.
 */
Registry.as<IConfigurationMigrationRegistry>(Extensions.ConfigurationMigration).registerConfigurationMigrations([
	{
		key: 'positron.assistant.models.overrides.anthropic',
		migrateFn: (value: unknown): ConfigurationKeyValuePairs => [
			['ai.models.anthropic', { value }],
			['positron.assistant.models.overrides.anthropic', { value: undefined }],
		],
	},
	{
		key: 'positron.assistant.models.overrides.amazonBedrock',
		migrateFn: (value: unknown): ConfigurationKeyValuePairs => [
			['ai.models.amazonBedrock', { value }],
			['positron.assistant.models.overrides.amazonBedrock', { value: undefined }],
		],
	},
	{
		key: 'positron.assistant.models.overrides.snowflakeCortex',
		migrateFn: (value: unknown): ConfigurationKeyValuePairs => [
			['ai.models.snowflakeCortex', { value }],
			['positron.assistant.models.overrides.snowflakeCortex', { value: undefined }],
		],
	},
	{
		key: 'positron.assistant.models.overrides.msFoundry',
		migrateFn: (value: unknown): ConfigurationKeyValuePairs => [
			['ai.models.msFoundry', { value }],
			['positron.assistant.models.overrides.msFoundry', { value: undefined }],
		],
	},
	{
		key: 'positron.assistant.models.overrides.openAI',
		migrateFn: (value: unknown): ConfigurationKeyValuePairs => [
			['ai.models.openAI', { value }],
			['positron.assistant.models.overrides.openAI', { value: undefined }],
		],
	},
	{
		key: 'positron.assistant.models.overrides.customProvider',
		migrateFn: (value: unknown): ConfigurationKeyValuePairs => [
			['ai.models.customProvider', { value }],
			['positron.assistant.models.overrides.customProvider', { value: undefined }],
		],
	},
	{
		key: 'positron.assistant.models.overrides.positAI',
		migrateFn: (value: unknown): ConfigurationKeyValuePairs => [
			['ai.models.positAI', { value }],
			['positron.assistant.models.overrides.positAI', { value: undefined }],
		],
	},
	{
		key: 'positron.assistant.models.overrides.google',
		migrateFn: (value: unknown): ConfigurationKeyValuePairs => [
			['ai.models.gemini', { value }],
			['positron.assistant.models.overrides.google', { value: undefined }],
		],
	},
]);
