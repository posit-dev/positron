/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { getStoredModels } from './config';
import { DEFAULT_MAX_TOKEN_INPUT, DEFAULT_MAX_TOKEN_OUTPUT } from './constants.js';
import { BufferedLogOutputChannel } from './logBuffer.js';
import { getLanguageModels } from './models.js';

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Retrieves non-default settings for an extension.
 * @param extensionId The full extension identifier (e.g., 'positron.positron-assistant')
 * @param configPrefix The configuration prefix to filter by (e.g., 'positron.assistant')
 * @param hiddenSettingKeys Optional array of setting keys not declared in package.json
 * @returns Record of non-default settings with their values
 */
function getExtensionSettings(
	extensionId: string,
	configPrefix: string,
	hiddenSettingKeys: string[] = []
): Record<string, unknown> {
	const extension = vscode.extensions.getExtension(extensionId);
	const settingKeys: string[] = [];

	if (extension?.packageJSON?.contributes?.configuration) {
		const configurations = Array.isArray(extension.packageJSON.contributes.configuration)
			? extension.packageJSON.contributes.configuration
			: [extension.packageJSON.contributes.configuration];

		for (const config of configurations) {
			if (config.properties) {
				for (const key of Object.keys(config.properties)) {
					if (key.startsWith(configPrefix + '.')) {
						settingKeys.push(key.substring(configPrefix.length + 1));
					}
				}
			}
		}
	}

	const allSettingKeys = [...settingKeys, ...hiddenSettingKeys];
	const config = vscode.workspace.getConfiguration(configPrefix);
	const settings: Record<string, unknown> = {};

	for (const key of allSettingKeys) {
		const inspection = config.inspect(key);
		const value = config.get(key);

		if (inspection && value !== inspection.defaultValue) {
			settings[`${configPrefix}.${key}`] = value;
		}
	}

	return settings;
}

function getRelatedSettings(): string {
	const assistantSettings = getExtensionSettings(
		'positron.positron-assistant',
		'positron.assistant',
		['enabledProviders']
	);

	const copilotSettings = getExtensionSettings(
		'github.copilot-chat',
		'github.copilot'
	);

	const allSettings = { ...assistantSettings, ...copilotSettings };

	if (Object.keys(allSettings).length === 0) {
		return '\n  // No non-default settings configured';
	}

	return '\n' + Object.entries(allSettings)
		.map(([key, value]) => `  "${key}": ${JSON.stringify(value, null, 2).split('\n').join('\n  ')}`)
		.join(',\n');
}

async function getConfiguredProviders(context: vscode.ExtensionContext, log: BufferedLogOutputChannel): Promise<string> {
	const storedModels = getStoredModels(context);
	const envModels = getEnvironmentConfiguredModels();

	const modelsByProvider = new Map<string, typeof storedModels>();
	for (const model of storedModels) {
		const existing = modelsByProvider.get(model.provider);
		if (existing) {
			existing.push(model);
		} else {
			modelsByProvider.set(model.provider, [model]);
		}
	}

	const modelInfos = await Promise.all(
		Array.from(modelsByProvider.entries()).map(async ([provider, models]) => {
			// Use the first model for shared properties
			const firstModel = models[0];
			const types = [...new Set(models.map(m => m.type))];

			const fields = [
				`- **${firstModel.name}**`,
				`	- Provider: ${provider}`,
				`	- Types: ${types.join(', ')}`,
			];

			if (firstModel.baseUrl) {
				fields.push(`	- Base URL: ${firstModel.baseUrl}`);
			}

			// Report if an API key is configured (check first model's ID)
			try {
				const apiKey = await context.secrets.get(`apiKey-${firstModel.id}`);
				if (apiKey) {
					fields.push(`	- API Key: Yes`);
				}
			} catch (error) {
				log.trace(`Failed to check API key for model ${firstModel.id}: ${formatError(error)}`);
			}

			return fields.join('\n');
		})
	);

	const allModels = [...modelInfos];
	if (envModels) {
		allModels.push(envModels);
	}

	if (allModels.length === 0) {
		return 'No models configured';
	}

	return allModels.join('\n\n');
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

function getEnvironmentConfiguredModels(): string {
	const models = getLanguageModels();
	const envModels = models
		.filter(model => {
			const defaults = model.source.defaults as any;
			if (!('apiKeyEnvVar' in defaults && defaults.apiKeyEnvVar)) {
				return false;
			}
			const envVarConfig = defaults.apiKeyEnvVar as { key: string; signedIn: boolean };
			const key = envVarConfig.key;
			// Only include if the environment variable is actually set
			return !!process.env[key];
		})
		.map(model => {
			const defaults = model.source.defaults as any;
			const envVarConfig = defaults.apiKeyEnvVar as { key: string; signedIn: boolean };
			const key = envVarConfig.key;

			const fields = [
				`- **${model.source.provider.displayName}**`,
				`\t- Provider: ${model.source.provider.id}`,
				`\t- Type: ${model.source.type}`,
				`\t- API Key: Yes (\`${key}\`)`,
			];

			return fields.join('\n');
		});

	return envModels.length > 0 ? envModels.join('\n\n') : '';
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

### Extension Settings

Positron Assistant and GitHub Copilot settings:

\`\`\`json${getRelatedSettings()}
\`\`\`

## Language Model Providers

## Configured Providers

${await getConfiguredProviders(context, log)}

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
