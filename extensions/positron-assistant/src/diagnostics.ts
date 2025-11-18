/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { getStoredModels } from './config';
import { DEFAULT_MAX_TOKEN_INPUT, DEFAULT_MAX_TOKEN_OUTPUT } from './constants.js';
import { BufferedLogOutputChannel } from './logBuffer.js';

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function getAssistantSettings(): string {
	// VS Code's API doesn't provide a way to iterate over keys so we maintain a list here
	// Alternatively we could iterate on package.json
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

	const config = vscode.workspace.getConfiguration('positron.assistant');
	const settings: Record<string, unknown> = {};

	for (const key of settingKeys) {
		const inspection = config.inspect(key);
		const value = config.get(key);

		if (inspection && value !== inspection.defaultValue) {
			settings[`positron.assistant.${key}`] = value;
		}
	}

	if (Object.keys(settings).length === 0) {
		return '\n  // No non-default settings configured';
	}

	return '\n' + Object.entries(settings)
		.map(([key, value]) => `  "${key}": ${JSON.stringify(value, null, 2).split('\n').join('\n  ')}`)
		.join(',\n');
}

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

		if (model.toolCalls !== undefined) {
			fields.push(`	- Tool Calls: ${model.toolCalls}`);
		}

		if (model.completions !== undefined) {
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
			log.trace(`Failed to check API key for model ${model.id}: ${formatError(error)}`);
		}

		fields.push(
			`	- Max Input Tokens: ${model.maxInputTokens ?? `default (${DEFAULT_MAX_TOKEN_INPUT})`}`,
			`	- Max Output Tokens: ${model.maxOutputTokens ?? `default (${DEFAULT_MAX_TOKEN_OUTPUT})`}`
		);

		return fields.join('\n');
	}));

	return modelInfos.join('\n\n');
}

async function getAvailableModels(): Promise<string> {
	try {
		const models = await vscode.lm.selectChatModels();

		if (models.length === 0) {
			return 'No language models available';
		}

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
		return `Error retrieving models: ${formatError(error)}`;
	}
}

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
			if (lastRequest.modelId) {
				currentModel = lastRequest.modelId;
			}
		}

		return `Active chat session found:
- Total requests: ${requestCount}
- Current agent/model: ${currentModel}
- Location: ${chatData.initialLocation || 'N/A'}`;
	} catch (error) {
		return `Error retrieving chat export: ${formatError(error)}`;
	}
}

function getVersionInfo(): string {
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

export async function generateDiagnosticsContent(context: vscode.ExtensionContext, log: BufferedLogOutputChannel): Promise<string> {
	return `# Positron Assistant Diagnostics

Generated: ${new Date().toISOString()}

**Privacy Notice**: This diagnostic report includes:
- Extension versions and configuration settings
- Model configurations (including base URLs and model IDs)
- System information (OS, architecture)
- Recent log entries
- Chat session metadata

**The report does NOT include API keys or authentication tokens.** However, base URLs may reveal internal endpoints, and configuration settings might expose security policies. Please review carefully before sharing.

## Version Information

${getVersionInfo()}

## Configuration Settings

### Positron Assistant Settings (Non-Default)

\`\`\`json${getAssistantSettings()}
\`\`\`

## Language Model Providers

## Configured Providers

${await getModelInfo(context, log)}

### Available Models

${await getAvailableModels()}

## Active Chat Session

${await getChatExportInfo()}

## Positron Assistant Logs

Recent log entries (last 500):

\`\`\`
${log.formatEntriesForDiagnostics()}
\`\`\`

---

`;
}

export async function collectDiagnostics(context: vscode.ExtensionContext, log: BufferedLogOutputChannel): Promise<void> {
	const content = await generateDiagnosticsContent(context, log);

	const document = await vscode.workspace.openTextDocument({
		language: 'markdown',
		content: content
	});

	await vscode.window.showTextDocument(document);
}
