/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { getStoredModels, getEnabledProviders } from './config';

/**
 * Helper function to append text to a document editor.
 */
async function appendText(editor: vscode.TextEditor, text: string): Promise<void> {
	await editor.edit(builder => {
		const lastLine = editor.document.lineAt(editor.document.lineCount - 1);
		builder.insert(lastLine.range.end, text);
	});
}

/**
 * Get all Positron Assistant configuration settings with non-default values.
 */
function getAssistantSettings(): string {
	const config = vscode.workspace.getConfiguration('positron.assistant');
	const settings: Record<string, unknown> = {};

	// List of all Positron Assistant settings
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

	for (const key of settingKeys) {
		const inspection = config.inspect(key);
		const value = config.get(key);

		// Only include settings that differ from default
		if (inspection && value !== inspection.defaultValue) {
			// Check if it's not just an empty array/object matching default empty array/object
			const isEmptyArrayOrObject =
				(Array.isArray(value) && Array.isArray(inspection.defaultValue) &&
					value.length === 0 && inspection.defaultValue.length === 0) ||
				(typeof value === 'object' && typeof inspection.defaultValue === 'object' &&
					!Array.isArray(value) && !Array.isArray(inspection.defaultValue) &&
					Object.keys(value).length === 0 && Object.keys(inspection.defaultValue).length === 0);

			if (!isEmptyArrayOrObject) {
				settings[`positron.assistant.${key}`] = value;
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
 * Get GitHub Copilot Chat configuration settings with non-default values.
 */
function getCopilotChatSettings(): string {
	const config = vscode.workspace.getConfiguration('github.copilot');
	const settings: Record<string, any> = {};

	// Key Copilot settings that may affect Assistant behavior
	const settingKeys = [
		'enable',
		'chat.enableChatCompletion',
		'advanced.debug.useElectronFetcher',
		'advanced.debug.useNodeFetcher',
		'advanced.debug.useNodeFetchFetcher',
	];

	for (const key of settingKeys) {
		const inspection = config.inspect(key);
		const value = config.get(key);

		if (inspection && value !== inspection.defaultValue) {
			settings[`github.copilot.${key}`] = value;
		}
	}

	if (Object.keys(settings).length === 0) {
		return '\n  // No non-default Copilot settings configured';
	}

	return '\n' + Object.entries(settings)
		.map(([key, value]) => `  "${key}": ${JSON.stringify(value, null, 2).split('\n').join('\n  ')}`)
		.join(',\n');
}

/**
 * Get information about stored language models and providers.
 */
function getModelInfo(context: vscode.ExtensionContext): string {
	const storedModels = getStoredModels(context);

	if (storedModels.length === 0) {
		return 'No models configured';
	}

	return storedModels.map(model => {
		// Sanitize sensitive information
		const sanitized = {
			id: model.id,
			provider: model.provider,
			name: model.name,
			model: model.model,
			type: model.type,
			toolCalls: model.toolCalls,
			completions: model.completions,
			baseUrl: model.baseUrl ? '[REDACTED]' : undefined,
			maxInputTokens: model.maxInputTokens,
			maxOutputTokens: model.maxOutputTokens,
		};

		return `- **${model.name}**
	- Provider: ${model.provider}
	- Type: ${model.type}
	- Model ID: ${model.model}
	- Tool Calls: ${model.toolCalls ?? 'N/A'}
	- Completions: ${model.completions ?? 'N/A'}
	- Base URL: ${sanitized.baseUrl ?? 'default'}
	- Max Input Tokens: ${model.maxInputTokens ?? 'default'}
	- Max Output Tokens: ${model.maxOutputTokens ?? 'default'}`;
	}).join('\n\n');
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
		const chatData = chatExport as any;

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
- VS Code: ${vscode.version}
- Positron: ${vscode.env.appName}
- OS: ${process.platform} ${process.arch}${vscode.env.remoteName ? `\n- Remote: ${vscode.env.remoteName}` : ''}`;
}

/**
 * Get log output from the Assistant output channel.
 * Note: VS Code doesn't provide API access to output channel content,
 * so we can only provide a reference.
 */
function getLogReference(): string {
	return `Log output is available in the Output panel:
- View → Output
- Select "Assistant" from the dropdown
- Select "GitHub Copilot Language Server" for Copilot logs

To include logs in a bug report:
1. Reproduce the issue
2. Open the Output panel
3. Copy relevant log entries manually`;
}

/**
 * Collect and display comprehensive diagnostics for Positron Assistant.
 */
export async function collectDiagnostics(context: vscode.ExtensionContext): Promise<void> {
	// Create a new untitled markdown document
	const document = await vscode.workspace.openTextDocument({
		language: 'markdown',
		content: ''
	});
	const editor = await vscode.window.showTextDocument(document);

	// Header
	await appendText(editor, '# Positron Assistant Diagnostics\n\n');
	await appendText(editor, `Generated: ${new Date().toISOString()}\n\n`);

	// Extension Information
	await appendText(editor, '## Extension Information\n\n');
	await appendText(editor, getExtensionInfo());
	await appendText(editor, '\n\n');

	// Configuration Settings
	await appendText(editor, '## Configuration Settings\n\n');
	await appendText(editor, '### Positron Assistant Settings (Non-Default)\n\n');
	await appendText(editor, '```json' + getAssistantSettings() + '\n```\n\n');

	await appendText(editor, '### GitHub Copilot Settings (Non-Default)\n\n');
	await appendText(editor, '```json' + getCopilotChatSettings() + '\n```\n\n');

	// Providers
	await appendText(editor, '## Language Model Providers\n\n');

	await appendText(editor, '### Enabled Providers (Configuration)\n\n');
	try {
		const enabledProviders = await getEnabledProviders();
		if (enabledProviders.length === 0) {
			await appendText(editor, 'All providers enabled (no filter configured)\n\n');
		} else {
			await appendText(editor, enabledProviders.map(p => `- ${p}`).join('\n') + '\n\n');
		}
	} catch (error) {
		await appendText(editor, `Error: ${error instanceof Error ? error.message : String(error)}\n\n`);
	}

	await appendText(editor, '### Positron Supported Providers\n\n');
	await appendText(editor, await getPositronProviders());
	await appendText(editor, '\n\n');

	await appendText(editor, '### Available Models (VS Code Language Model API)\n\n');
	await appendText(editor, await getAvailableProviders());
	await appendText(editor, '\n\n');

	// Configured Models
	await appendText(editor, '## Configured Models\n\n');
	await appendText(editor, getModelInfo(context));
	await appendText(editor, '\n\n');

	// Active Chat Session
	await appendText(editor, '## Active Chat Session\n\n');
	await appendText(editor, await getChatExportInfo());
	await appendText(editor, '\n\n');

	// Logs
	await appendText(editor, '## Logs\n\n');
	await appendText(editor, getLogReference());
	await appendText(editor, '\n\n');

	// Footer
	await appendText(editor, '---\n\n');
	await appendText(editor, '## Documentation\n\n');
	await appendText(editor, '- [Positron Assistant Documentation](https://positron.posit.co/assistant)\n');
	await appendText(editor, '- [Report Issues](https://github.com/posit-dev/positron/issues)\n');
}
