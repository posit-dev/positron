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

/**
 * YAML frontmatter metadata for prompt files
 */
interface PromptMetadata<T = PromptMetadataMode | PromptMetadataMode[]> {
	description?: string;
	mode?: T;
	tools?: string[];
	command?: string;
	order?: number;
}

/** Possible vales for the `mode` prompt metadata property */
type PromptMetadataMode = positron.PositronChatMode | positron.PositronChatAgentLocation;

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
	context?: vscode.ChatContext;
	request?: vscode.ChatRequest;
	document?: vscode.TextDocument;
	sessions?: Array<positron.LanguageRuntimeMetadata>;
	streamingEdits?: boolean;
}

/**
 * Parse YAML frontmatter from markdown content
 */
function parseYamlFrontmatter(content: string): PromptDocument {
	const yamlMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

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
function findMarkdownFiles(dir: string): string[] {
	const files: string[] = [];

	try {
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				files.push(...findMarkdownFiles(fullPath));
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
function loadPromptDocuments(promptsDir: string): ParsedPromptDocument[] {
	const documents: ParsedPromptDocument[] = [];
	const markdownFiles = findMarkdownFiles(promptsDir);

	for (const filePath of markdownFiles) {
		try {
			const fileContent = fs.readFileSync(filePath, 'utf8');
			const { metadata, content } = parseYamlFrontmatter(fileContent);
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
function mergeMetadata(documents: ParsedPromptDocument[]) {
	const merged: PromptMetadata<PromptMetadataMode[]> = {};
	const allTools = new Set<string>();
	const allModes = new Set<PromptMetadataMode>();

	for (const doc of documents) {
		// Combine tools arrays
		if (doc.metadata.tools) {
			doc.metadata.tools.forEach(tool => allTools.add(tool));
		}

		// Combine modes
		if (doc.metadata.mode && typeof doc.metadata.mode === 'string') {
			allModes.add(doc.metadata.mode);
		} else if (doc.metadata.mode) {
			doc.metadata.mode.forEach(mode => allModes.add(mode));
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
function mergeContent(documents: ParsedPromptDocument[]): string {
	return documents.map(doc => doc.content.trim()).join('\n\n');
}

/**
 * Get combined prompt metadata for a specific command
 */
export function getCommandMetadata(command: string) {
	const commandsPath = path.join(MARKDOWN_DIR, 'prompts', 'commands');
	const documents = loadPromptDocuments(commandsPath);
	const matchingDocuments: ParsedPromptDocument[] = [];
	for (const doc of documents) {
		if (doc.metadata.command === command) {
			matchingDocuments.push(doc);
		}
	}

	if (matchingDocuments.length === 0) {
		throw new Error(`No prompt documents found for command: ${command}`);
	}
	return mergeMetadata(matchingDocuments);
}

/**
 * Get combined prompt for a specific command
 */
export function getCommandPrompt(command: string, request: vscode.ChatRequest, context: vscode.ChatContext): PromptDocument {
	const commandsPath = path.join(MARKDOWN_DIR, 'prompts', 'commands');
	const documents = loadPromptDocuments(commandsPath);
	const matchingDocuments: ParsedPromptDocument[] = [];
	for (const doc of documents) {
		if (doc.metadata.command === command) {
			matchingDocuments.push(doc);
		}
	}

	if (matchingDocuments.length === 0) {
		throw new Error(`No prompt documents found for command: ${command}`);
	}

	// Merge prompts
	const mergedContent = mergeContent(matchingDocuments);
	const mergedMetadata = mergeMetadata(matchingDocuments);

	// Render prompt template
	const data: PromptRenderData = { context, request };
	log.trace('[PromptRender] Rendering prompt for command:', command, 'with data:', JSON.stringify(data));
	const result = Sqrl.render(mergedContent, data, { varName: 'positron' });

	return {
		content: result,
		metadata: mergedMetadata,
	};
}

/**
 * Get combined prompt for a specific command
 */
export function getModePrompt(mode: PromptMetadataMode, data: PromptRenderData, promptDir?: string): PromptDocument {
	const commandsPath = promptDir ?? path.join(MARKDOWN_DIR, 'prompts', 'chat');
	const documents = loadPromptDocuments(commandsPath);
	const matchingDocuments: ParsedPromptDocument[] = [];
	for (const doc of documents) {
		if (doc.metadata.mode === mode || (Array.isArray(doc.metadata.mode) && doc.metadata.mode.includes(mode))) {
			matchingDocuments.push(doc);
		}
	}

	// Sort entries by order metadata
	matchingDocuments.sort((a, b) => (a.metadata.order ?? 0) - (b.metadata.order ?? 0));

	if (matchingDocuments.length === 0) {
		throw new Error(`No prompt documents found for mode: ${mode}`);
	}

	// Merge prompts
	const mergedContent = mergeContent(matchingDocuments);
	const mergedMetadata = mergeMetadata(matchingDocuments);

	// Render prompt template
	log.trace('[PromptRender] Rendering prompt for mode:', mode, 'with data:', JSON.stringify(data));
	const result = Sqrl.render(mergedContent, data, { varName: 'positron' });

	return {
		content: result,
		metadata: mergedMetadata,
	};
}
