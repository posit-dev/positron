/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as positron from 'positron';
import * as yaml from 'yaml';
import * as Sqrl from 'squirrelly';
import { MARKDOWN_DIR } from './constants';
import { log } from './extension.js';

const PROMPT_MODE_SELECTIONS_KEY = 'positron.assistant.promptModeSelections';

type StoredPromptSelectionConfig = Partial<Record<PromptMetadataMode, { file: string; enabled: boolean }[]>>;

//#region Prompt templating

/**
 * YAML frontmatter metadata for prompt files
 */
export interface PromptMetadata<T = PromptMetadataMode | PromptMetadataMode[]> {
	description?: string;
	mode?: T;
	tools?: string[];
	command?: string;
	order?: number;
}

/** Possible vales for the `mode` prompt metadata property */
export type PromptMetadataMode = positron.PositronChatMode | positron.PositronChatAgentLocation;

/**
 * Parsed prompt document
 */
interface ParsedPromptDocument {
	metadata: PromptMetadata;
	content: string;
	filePath: string;
}

/**
 * Parsed & merged command prompt document
 */
interface PromptDocument {
	metadata: PromptMetadata;
	content: string;
}

/**
 * Metadata for the `positron` data object passed to prompt templates
 */
interface PromptRenderData {
	request?: vscode.ChatRequest;
	document?: vscode.TextDocument;
	sessions?: Array<positron.LanguageRuntimeMetadata>;
	streamingEdits?: boolean;
}

export class PromptRenderer {
	private static _instance: PromptRenderer | undefined;
	constructor(public extensionContext: vscode.ExtensionContext) {
		if (!PromptRenderer._instance) {
			PromptRenderer._instance = this;
		}
	}

	/**
	 * Get the singleton instance of PromptRenderer
	 */
	static get instance(): PromptRenderer {
		if (!PromptRenderer._instance) {
			throw new Error('PromptRenderer has not been initialized');
		}
		return PromptRenderer._instance;
	}

	/**
	 * Parse YAML frontmatter from markdown content
	 */
	private parseYamlFrontmatter(content: string): PromptDocument {
		// Match both Windows and Unix line endings
		const yamlMatch = content.match(/^---\r?\n([\s\S]*?)\n---\r?\n([\s\S]*)$/);

		if (!yamlMatch) {
			return { metadata: {}, content };
		}

		const yamlContent = yamlMatch[1];
		const markdownContent = yamlMatch[2];

		try {
			const metadata = yaml.parse(yamlContent) as PromptMetadata;
			return { metadata: metadata || {}, content: markdownContent };
		} catch (error) {
			log.warn('[PromptRender] Failed to parse YAML frontmatter:', error);
			return { metadata: {}, content: markdownContent };
		}
	}


	/**
	 * Recursively find all .md files in a directory
	 */
	private findMarkdownFiles(dir: string): string[] {
		const files: string[] = [];

		try {
			const entries = fs.readdirSync(dir, { withFileTypes: true });
			for (const entry of entries) {
				const fullPath = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					files.push(...this.findMarkdownFiles(fullPath));
				} else if (entry.isFile() && entry.name.endsWith('.md')) {
					files.push(fullPath);
				}
			}
		} catch (error) {
			log.warn('[PromptRender] Cannot read prompt files from prompt directory:', error);
		}

		return files;
	}

	/**
	 * Load and parse all prompt documents
	 */
	private loadPromptDocuments(promptsDir: string): ParsedPromptDocument[] {
		const documents: ParsedPromptDocument[] = [];
		const markdownFiles = this.findMarkdownFiles(promptsDir);

		for (const filePath of markdownFiles) {
			try {
				const fileContent = fs.readFileSync(filePath, 'utf8');
				const { metadata, content } = this.parseYamlFrontmatter(fileContent);
				documents.push({ metadata, content, filePath });
			} catch (error) {
				log.warn(`[PromptRender] Failed to load prompt file ${filePath}:`, error);
			}
		}

		return documents;
	}

	/**
	 * Merge metadata from multiple documents
	 */
	private mergeMetadata(documents: ParsedPromptDocument[]): PromptMetadata<PromptMetadataMode[]> {
		const merged: PromptMetadata<PromptMetadataMode[]> = {};
		const allTools = new Set<string>();
		const allModes = new Set<PromptMetadataMode>();

		for (const doc of documents) {
			// Combine tools arrays
			if (doc.metadata.tools) {
				doc.metadata.tools.forEach(tool => allTools.add(tool));
			}

			// Combine modes
			if (doc.metadata.mode) {
				if (Array.isArray(doc.metadata.mode)) {
					doc.metadata.mode.forEach(mode => allModes.add(mode));
				} else {
					allModes.add(doc.metadata.mode);
				}
			}

			// Set command
			if (doc.metadata.command) {
				merged.command = doc.metadata.command;
			}
		}

		merged.tools = Array.from(allTools);
		merged.mode = Array.from(allModes);

		return merged;
	}

	/**
	 * Merge content from multiple documents
	 */
	private mergeContent(documents: ParsedPromptDocument[]): string {
		return documents.map(doc => doc.content.trim()).join('\n\n');
	}

	/**
	 * Get combined prompt metadata for a specific command
	 */
	static getCommandMetadata(command: string): PromptMetadata<PromptMetadataMode[]> {
		return PromptRenderer.instance._getCommandMetadata(command);
	}

	private _getCommandMetadata(command: string): PromptMetadata<PromptMetadataMode[]> {
		const commandsPath = path.join(MARKDOWN_DIR, 'prompts', 'commands');
		const documents = this.loadPromptDocuments(commandsPath);
		const matchingDocuments: ParsedPromptDocument[] = [];
		const allCommands = new Set<string>();
		for (const doc of documents) {
			if (doc.metadata.command) {
				allCommands.add(doc.metadata.command);
			}
			if (doc.metadata.command === command) {
				matchingDocuments.push(doc);
			}
		}

		if (matchingDocuments.length === 0) {
			throw new Error(`No prompt documents found for command: ${command} in ${commandsPath} (available commands: ${Array.from(allCommands).join(', ')})`);
		}
		return this.mergeMetadata(matchingDocuments);
	}

	/**
	 * Get combined prompt for a specific command
	 */
	static renderCommandPrompt(command: string, request: vscode.ChatRequest): PromptDocument {
		return PromptRenderer.instance._renderCommandPrompt(command, request);
	}

	private _renderCommandPrompt(command: string, request: vscode.ChatRequest): PromptDocument {
		const commandsPath = path.join(MARKDOWN_DIR, 'prompts', 'commands');
		const documents = this.loadPromptDocuments(commandsPath);
		const matchingDocuments: ParsedPromptDocument[] = [];
		const allCommands = new Set<string>();
		for (const doc of documents) {
			if (doc.metadata.command) {
				allCommands.add(doc.metadata.command);
			}
			if (doc.metadata.command === command) {
				matchingDocuments.push(doc);
			}
		}

		if (matchingDocuments.length === 0) {
			throw new Error(`No prompt documents found for command: ${command} in ${commandsPath} (available commands: ${Array.from(allCommands).join(', ')})`);
		}

		// Merge prompts
		const mergedContent = this.mergeContent(matchingDocuments);
		const mergedMetadata = this.mergeMetadata(matchingDocuments);

		// Render prompt template
		const data: PromptRenderData = { request };
		log.trace('[PromptRender] Rendering prompt for command:', command, 'with data:', JSON.stringify(data));
		const result = Sqrl.render(mergedContent, data, { varName: 'positron' });

		return {
			content: result,
			metadata: mergedMetadata,
		};
	}

	/**
	 * Get all prompt documents for a specific mode, optionally filtering by saved selections
	 */
	getModePromptDocuments(mode: PromptMetadataMode, fromSaved: boolean = true): ParsedPromptDocument[] {
		const dir = path.join(MARKDOWN_DIR, 'prompts', 'chat');
		const documents = this.loadPromptDocuments(dir);

		// Read saved selections from storage
		const savedSelections = this.extensionContext.globalState?.get<StoredPromptSelectionConfig>(PROMPT_MODE_SELECTIONS_KEY) || {};
		const selections = savedSelections[mode];

		const matchingDocuments: ParsedPromptDocument[] = documents
			.filter(doc => doc.metadata.mode === mode || (Array.isArray(doc.metadata.mode) && doc.metadata.mode.includes(mode)))
			.filter(doc => {
				const selection = selections?.find(s => s.file === path.basename(doc.filePath));
				return (fromSaved && selection) ? selection.enabled : true;
			});

		// Sort entries by order metadata
		matchingDocuments.sort((a, b) => (a.metadata.order ?? 0) - (b.metadata.order ?? 0));

		return matchingDocuments;
	}

	/**
	 * Get combined prompt for a specific command
	 */
	static renderModePrompt(mode: PromptMetadataMode, data: PromptRenderData): PromptDocument {
		return PromptRenderer.instance._renderModePrompt(mode, data);
	}

	private _renderModePrompt(mode: PromptMetadataMode, data: PromptRenderData): PromptDocument {
		const matchingDocuments = this.getModePromptDocuments(mode);
		if (matchingDocuments.length === 0) {
			return { content: '', metadata: {} };
		}

		// Merge prompts
		const mergedContent = this.mergeContent(matchingDocuments);
		const mergedMetadata = this.mergeMetadata(matchingDocuments);

		// Render prompt template
		log.trace('[PromptRender] Rendering prompt for mode:', mode, 'with data:', JSON.stringify(data));
		const result = Sqrl.render(mergedContent, data, { varName: 'positron' }) as string;

		return {
			content: result,
			metadata: mergedMetadata,
		};
	}
}

//#region Prompt management

async function showInitialPromptPick(renderer: PromptRenderer) {
	const context = renderer.extensionContext;
	const quickPick = vscode.window.createQuickPick();
	quickPick.placeholder = vscode.l10n.t('Select a mode');

	quickPick.items = [
		{ label: 'Built-in Modes', kind: vscode.QuickPickItemKind.Separator },
		{ label: 'Ask', description: vscode.l10n.t('Ask mode in the chat panel') },
		{ label: 'Edit', description: vscode.l10n.t('Edit mode in the chat panel') },
		{ label: 'Agent', description: vscode.l10n.t('Agent mode in the chat panel') },
		{ label: 'Editor', description: vscode.l10n.t('Inline editor chat') },
		{ label: 'Terminal', description: vscode.l10n.t('Inline Terminal chat') },
		{ label: 'Notebook', description: vscode.l10n.t('Notebook chat') },
		{ label: 'Miscellaneous', kind: vscode.QuickPickItemKind.Separator },
		{ label: 'Reset', description: vscode.l10n.t('Reset all prompt configuration to the default values.') },
	];

	quickPick.onDidAccept(() => {
		const selected = quickPick.selectedItems[0];
		quickPick.hide();

		switch (selected?.label) {
			case 'Ask':
				showPromptModePick(context, positron.PositronChatMode.Ask);
				break;
			case 'Edit':
				showPromptModePick(context, positron.PositronChatMode.Edit);
				break;
			case 'Agent':
				showPromptModePick(context, positron.PositronChatMode.Agent);
				break;
			case 'Editor':
				showPromptModePick(context, positron.PositronChatAgentLocation.Editor);
				break;
			case 'Terminal':
				showPromptModePick(context, positron.PositronChatAgentLocation.Terminal);
				break;
			case 'Notebook':
				showPromptModePick(context, positron.PositronChatAgentLocation.Notebook);
				break;
			case 'Reset':
				context.globalState.update(PROMPT_MODE_SELECTIONS_KEY, undefined);
				break;
		}
	});

	quickPick.onDidHide(() => quickPick.dispose());
	quickPick.show();
}

async function showPromptModePick(context: vscode.ExtensionContext, mode: PromptMetadataMode) {
	const savedSelections = context.globalState?.get<StoredPromptSelectionConfig>(PROMPT_MODE_SELECTIONS_KEY) || {};

	const quickPick = vscode.window.createQuickPick();
	quickPick.canSelectMany = true;
	quickPick.placeholder = 'Select prompts';

	// Built-in prompts
	const docs = PromptRenderer.instance.getModePromptDocuments(mode, false);
	const builtinItems = docs.map(doc => {
		const label = path.basename(doc.filePath);
		const description = doc.metadata.description;
		const picked = savedSelections[mode]?.find(s => s.file === label)?.enabled ?? true;
		return { label, picked, description };
	});

	quickPick.items = [
		{ label: 'Built-in Prompts', kind: vscode.QuickPickItemKind.Separator },
		...builtinItems,
	];
	quickPick.selectedItems = quickPick.items.filter(item => item.picked);

	quickPick.onDidAccept(() => {
		const selectedItems = quickPick.items
			.filter(item => item.kind !== vscode.QuickPickItemKind.Separator)
			.map(item => ({ file: item.label, enabled: quickPick.selectedItems.includes(item) }));

		const newSelections = { ...savedSelections, [mode]: selectedItems };
		context.globalState.update(PROMPT_MODE_SELECTIONS_KEY, newSelections);
		quickPick.hide();
	});

	quickPick.onDidHide(() => quickPick.dispose());
	quickPick.show();
}

export function registerPromptManagement(context: vscode.ExtensionContext) {
	// Intialise prompt renderer
	const renderer = new PromptRenderer(context);

	// Register prompt management quickpick command
	const disposable = vscode.commands.registerCommand(
		'positron-assistant.managePromptFiles',
		() => showInitialPromptPick(renderer)
	);
	context.subscriptions.push(disposable);
}
