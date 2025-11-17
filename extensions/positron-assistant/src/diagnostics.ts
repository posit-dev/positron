/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { getStoredModels, getEnabledProviders } from './config';
import { DEFAULT_MAX_TOKEN_INPUT, DEFAULT_MAX_TOKEN_OUTPUT } from './constants.js';
import { BufferedLogOutputChannel, DIAGNOSTIC_LOG_BUFFER_SIZE } from './logBuffer.js';

interface ChatExportData {
	requests?: Array<{
		response?: {
			agent?: string;
		};
	}>;
	initialLocation?: string;
}

/**
 * Check if a value is an empty array or object that matches the default empty array or object.
 * This helps filter out settings that appear different but are functionally the same.
 * @param value The current value of the setting
 * @param defaultValue The default value of the setting
 * @returns True if both are empty arrays or empty objects
 */
function isEmptyArrayOrObjectMatchingDefault(value: unknown, defaultValue: unknown): boolean {
	// Check for matching empty arrays
	const isBothEmptyArrays = Array.isArray(value) && Array.isArray(defaultValue) &&
		value.length === 0 && defaultValue.length === 0;

	// Check for matching empty objects (excluding arrays)
	const isBothEmptyObjects = typeof value === 'object' && typeof defaultValue === 'object' &&
		value !== null && defaultValue !== null &&
		!Array.isArray(value) && !Array.isArray(defaultValue) &&
		Object.keys(value).length === 0 && Object.keys(defaultValue).length === 0;

	return isBothEmptyArrays || isBothEmptyObjects;
}

/**
 * Get configuration settings with non-default values for a given section.
 * @param configSection The configuration section to inspect (e.g., 'positron.assistant')
 * @param settingKeys Array of setting keys to check
 * @returns A formatted string containing settings that differ from their default values
 */
function getNonDefaultSettings(configSection: string, settingKeys: string[]): string {
	const config = vscode.workspace.getConfiguration(configSection);
	const settings: Record<string, unknown> = {};

	for (const key of settingKeys) {
		const inspection = config.inspect(key);
		const value = config.get(key);

		if (inspection && value !== inspection.defaultValue) {
			if (!isEmptyArrayOrObjectMatchingDefault(value, inspection.defaultValue)) {
				settings[`${configSection}.${key}`] = value;
			}
		}
	}

	if (Object.keys(settings).length === 0) {
		return '\n  // No non-default settings configured';
	}

	return '\n' + Object.entries(settings)
		.map(([key, value]) => `  "${key}": ${JSON.stringify(value, null, 2).split('\n').join('\n  ')}`)
		.join(',\n');
}

/**
 * Get all Positron Assistant configuration settings with non-default values.
 */
function getAssistantSettings(): string {
	// VS Code's API doesn't provide a way to iterate over keys so we maintain a list here
	const settingKeys = [
		'enable',
		'toolDetails.enable',
		'useAnthropicSdk',
		'streamingEdits.enable',
		'inlineCompletions.enable',
		'inlineCompletionExcludes',
		'gitIntegration.enable',
		'showTokenUsage.enable',
		'maxInputTokens',
		'maxOutputTokens',
		'followups.enable',
		'consoleActions.enable',
		'notebookMode.enable',
		'toolErrors.propagate',
		'alwaysIncludeCopilotTools',
		'providerTimeout',
		'maxConnectionAttempts',
		'filterModels',
		'preferredModel',
		'defaultModels',
		'providerVariables.bedrock',
		'enabledProviders',
	];

	return getNonDefaultSettings('positron.assistant', settingKeys);
}

/**
 * Get GitHub Copilot Chat configuration settings with non-default values.
 */
function getCopilotChatSettings(): string {
	// Key Copilot settings that may affect Assistant behavior
	const settingKeys = [
		'enable',
		'chat.enableChatCompletion',
		'advanced.debug.useElectronFetcher',
		'advanced.debug.useNodeFetcher',
		'advanced.debug.useNodeFetchFetcher',
	];

	return getNonDefaultSettings('github.copilot', settingKeys);
}

/**
 * Get information about stored language models and providers.
 */
async function getModelInfo(context: vscode.ExtensionContext, log: BufferedLogOutputChannel): Promise<string> {
	const storedModels = getStoredModels(context);

	if (storedModels.length === 0) {
		return 'No models configured';
	}

	const modelInfos = await Promise.all(storedModels.map(async model => {
		const fields = [
			`- **${model.name}**`,
			`	- Provider: ${model.provider}`,
			`	- Type: ${model.type}`,
			`	- Model ID: ${model.model}`,
		];

		if (model.toolCalls !== undefined && model.toolCalls !== null) {
			fields.push(`	- Tool Calls: ${model.toolCalls}`);
		}

		if (model.completions !== undefined && model.completions !== null) {
			fields.push(`	- Completions: ${model.completions}`);
		}

		if (model.baseUrl) {
			fields.push(`	- Base URL: ${model.baseUrl}`);
		}

		// Report if an API key is configured
		try {
			const apiKey = await context.secrets.get(`apiKey-${model.id}`);
			if (apiKey) {
				fields.push(`	- API Key: Yes`);
			}
		} catch (error) {
			log.trace(`Failed to check API key for model ${model.id}: ${error instanceof Error ? error.message : String(error)}`);
		}

		fields.push(
			`	- Max Input Tokens: ${model.maxInputTokens ?? `default (${DEFAULT_MAX_TOKEN_INPUT})`}`,
			`	- Max Output Tokens: ${model.maxOutputTokens ?? `default (${DEFAULT_MAX_TOKEN_OUTPUT})`}`
		);

		return fields.join('\n');
	}));

	return modelInfos.join('\n\n');
}

/**
 * Get available language model providers from VS Code's Language Model API.
 */
async function getAvailableProviders(): Promise<string> {
	try {
		const models = await vscode.lm.selectChatModels();

		if (models.length === 0) {
			return 'No language models available through VS Code API';
		}

		// Group by vendor
		const byVendor: Record<string, vscode.LanguageModelChat[]> = {};
		for (const model of models) {
			if (!byVendor[model.vendor]) {
				byVendor[model.vendor] = [];
			}
			byVendor[model.vendor].push(model);
		}

		const sections = Object.entries(byVendor).map(([vendor, vendorModels]) => {
			const modelList = vendorModels
				.map(m => `  - ${m.name} (${m.id}) - Max Input: ${m.maxInputTokens ?? 'unknown'}`)
				.join('\n');
			return `**${vendor}** (${vendorModels.length} model${vendorModels.length !== 1 ? 's' : ''})\n${modelList}`;
		});

		return sections.join('\n\n');
	} catch (error) {
		return `Error retrieving models: ${error instanceof Error ? error.message : String(error)}`;
	}
}

/**
 * Get enabled providers from Positron AI API.
 */
async function getPositronProviders(): Promise<string> {
	try {
		const providers = await positron.ai.getSupportedProviders();
		if (providers.length === 0) {
			return 'No supported providers from Positron AI';
		}
		return providers.map(p => `- ${p}`).join('\n');
	} catch (error) {
		return `Error retrieving Positron providers: ${error instanceof Error ? error.message : String(error)}`;
	}
}

/**
 * Get chat export data.
 */
async function getChatExportInfo(): Promise<string> {
	try {
		const chatExport = await positron.ai.getChatExport();
		if (!chatExport) {
			return 'No active chat session';
		}

		// Cast to access internal structure (API returns object type for stability)
		const chatData = chatExport as ChatExportData;

		if (!chatData.requests || !Array.isArray(chatData.requests)) {
			return 'Chat session found but data format is unexpected';
		}

		const requestCount = chatData.requests.length;

		// Get the model/provider from the most recent request
		let currentModel = 'Unknown';
		if (requestCount > 0) {
			const lastRequest = chatData.requests[requestCount - 1];
			if (lastRequest.response?.agent) {
				currentModel = lastRequest.response.agent;
			}
		}

		return `Active chat session found:
- Total requests: ${requestCount}
- Current agent/model: ${currentModel}
- Location: ${chatData.initialLocation || 'N/A'}`;
	} catch (error) {
		return `Error retrieving chat export: ${error instanceof Error ? error.message : String(error)}`;
	}
}

/**
 * Get extension information.
 */
function getExtensionInfo(): string {
	const assistantExt = vscode.extensions.getExtension('positron.positron-assistant');
	const copilotExt = vscode.extensions.getExtension('github.copilot-chat');

	const assistantInfo = assistantExt
		? `Version ${assistantExt.packageJSON.version}${assistantExt.isActive ? ' (Active)' : ' (Inactive)'}`
		: 'Not installed';

	const copilotInfo = copilotExt
		? `Version ${copilotExt.packageJSON.version}${copilotExt.isActive ? ' (Active)' : ' (Inactive)'}`
		: 'Not installed';

	return `- Positron Assistant: ${assistantInfo}
- GitHub Copilot Chat: ${copilotInfo}
- Positron: ${positron.version} (build ${positron.buildNumber})
- Code OSS: ${vscode.version}
- Application: ${vscode.env.appName}
- OS: ${process.platform} ${process.arch}${vscode.env.remoteName ? `\n- Remote: ${vscode.env.remoteName}` : ''}`;
}

/**
 * Get log output from the Assistant output channel.
 */
function getAssistantLogs(log: BufferedLogOutputChannel): string {
	// Passing trace here will only retrieve trace logs if the user has enabled trace logging
	const logs = log.formatEntriesForDiagnostics(DIAGNOSTIC_LOG_BUFFER_SIZE);

	if (logs === 'No log entries available') {
		return 'No log entries captured yet. Logs are captured from the moment the extension loads.';
	}

	return logs;
}

/**
 * Get Copilot Language Server logs.
 * Attempts to access the buffered log target from the Copilot Chat extension.
 */
function getCopilotLogs(): string {
	try {
		const copilotExt = vscode.extensions.getExtension('github.copilot-chat');
		if (!copilotExt || !copilotExt.isActive) {
			return 'GitHub Copilot Chat extension is not active';
		}

		// Access the log target getter function from the extension exports
		const getCopilotLogTarget = (copilotExt.exports as any)?.getCopilotLogTarget;
		if (typeof getCopilotLogTarget !== 'function') {
			return 'Unable to access Copilot Chat logs (buffered logging may not be enabled)';
		}

		const logTarget = getCopilotLogTarget();
		if (!logTarget || typeof logTarget.formatEntriesForDiagnostics !== 'function') {
			return 'Unable to access Copilot Chat logs (log target not initialized)';
		}

		const logs = logTarget.formatEntriesForDiagnostics(DIAGNOSTIC_LOG_BUFFER_SIZE, COPILOT_LOG_LEVEL_TRACE);

		if (logs === 'No log entries available') {
			return 'No Copilot Chat log entries captured yet';
		}

		return logs;
	} catch (error) {
		return `Error retrieving Copilot Chat logs: ${error instanceof Error ? error.message : String(error)}`;
	}
}

/**
 * Generate comprehensive diagnostics content for Positron Assistant.
 * @returns The diagnostics content as a markdown string.
 */
export async function generateDiagnosticsContent(context: vscode.ExtensionContext, log: BufferedLogOutputChannel): Promise<string> {
	const parts: string[] = [];

	// Header
	parts.push('# Positron Assistant Diagnostics\n\n');
	parts.push(`Generated: ${new Date().toISOString()}\n\n`);
	parts.push('**⚠️ Privacy Notice**: This diagnostic report includes:\n');
	parts.push('- Extension versions and configuration settings\n');
	parts.push('- Model configurations (including base URLs and model IDs)\n');
	parts.push('- System information (OS, architecture)\n');
	parts.push('- Recent log entries\n');
	parts.push('- Chat session metadata\n\n');
	parts.push('**The report does NOT include API keys or authentication tokens.** However, base URLs may reveal internal endpoints, and configuration settings might expose security policies. Please review carefully before sharing publicly.\n\n');

	// Extension Information
	parts.push('## Extension Information\n\n');
	parts.push(getExtensionInfo());
	parts.push('\n\n');

	// Configuration Settings
	parts.push('## Configuration Settings\n\n');
	parts.push('### Positron Assistant Settings (Non-Default)\n\n');
	parts.push('```json' + getAssistantSettings() + '\n```\n\n');

	parts.push('### GitHub Copilot Settings (Non-Default)\n\n');
	parts.push('```json' + getCopilotChatSettings() + '\n```\n\n');

	// Providers
	parts.push('## Language Model Providers\n\n');

	// Configured Models
	parts.push('## Configured Providers and Models\n\n');
	parts.push(await getModelInfo(context, log));
	parts.push('\n\n');

	parts.push('### Enabled Providers \n\n');
	try {
		const enabledProviders = await getEnabledProviders();
		if (enabledProviders.length === 0) {
			parts.push('All providers enabled (no filter configured)\n\n');
		} else {
			parts.push(enabledProviders.map(p => `- ${p}`).join('\n') + '\n\n');
		}
	} catch (error) {
		parts.push(`Error: ${error instanceof Error ? error.message : String(error)}\n\n`);
	}

	parts.push('### Positron Supported Providers\n\n');
	parts.push(await getPositronProviders());
	parts.push('\n\n');

	parts.push('### Available Models (VS Code Language Model API)\n\n');
	parts.push(await getAvailableProviders());
	parts.push('\n\n');

	// Active Chat Session
	parts.push('## Active Chat Session\n\n');
	parts.push(await getChatExportInfo());
	parts.push('\n\n');

	// Logs
	parts.push('## Positron Assistant Logs\n\n');
	parts.push('Recent log entries (last 500):\n\n');
	parts.push('```\n');
	parts.push(getAssistantLogs(log));
	parts.push('\n```\n\n');

	parts.push('## GitHub Copilot Chat Logs\n\n');
	parts.push('Recent log entries (last 500):\n\n');
	const copilotLogs = getCopilotLogs();
	parts.push('```\n');
	parts.push(copilotLogs);
	parts.push('\n```\n');
	parts.push('\n\n');

	// Footer
	parts.push('---\n\n');
	parts.push('## Documentation\n\n');
	parts.push('- [Positron Assistant Documentation](https://positron.posit.co/assistant)\n');
	parts.push('- [Report Issues](https://github.com/posit-dev/positron/issues)\n');

	return parts.join('');
}

/**
 * Collect and display comprehensive diagnostics for Positron Assistant in a new document.
 */
export async function collectDiagnostics(context: vscode.ExtensionContext, log: BufferedLogOutputChannel): Promise<void> {
	const content = await generateDiagnosticsContent(context, log);

	// Create a new untitled markdown document with the content
	const document = await vscode.workspace.openTextDocument({
		language: 'markdown',
		content: content
	});

	await vscode.window.showTextDocument(document);
}
