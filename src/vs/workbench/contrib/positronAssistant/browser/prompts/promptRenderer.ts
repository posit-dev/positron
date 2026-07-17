/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { FileAccess } from '../../../../../base/common/network.js';
import { URI } from '../../../../../base/common/uri.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { PromptMetadataMode, PromptRenderData, PromptTemplateEngine } from './promptTemplateEngine.js';

/**
 * Location of the bundled chat prompt templates, relative to the app root.
 * The build copies these `.md` files into `out/` alongside the sources.
 */
const PROMPTS_CHAT_PATH = 'vs/workbench/contrib/positronAssistant/browser/media/prompts/chat';

/** Frontmatter fields the renderer uses to select and order prompt fragments. */
interface PromptFrontmatter {
	mode?: PromptMetadataMode | PromptMetadataMode[];
	order?: number;
}

interface ParsedPromptDocument {
	metadata: PromptFrontmatter;
	content: string;
}

/**
 * Loads and renders Positron Assistant's chat prompt templates.
 *
 * Templates are markdown files with a small YAML-ish frontmatter (`mode`,
 * `order`) that selects which fragments apply to a given chat mode. This is the
 * core counterpart of the renderer in the Positron Assistant extension.
 */
export class PromptRenderer {

	private _documents: ParsedPromptDocument[] | undefined;

	constructor(
		private readonly _fileService: IFileService,
		private readonly _promptsDir: URI = FileAccess.asFileUri(PROMPTS_CHAT_PATH),
	) { }

	/**
	 * Render the merged prompt for a chat mode.
	 *
	 * Fragments whose frontmatter `mode` matches are concatenated in `order` and
	 * rendered against the given data. Returns an empty string when no fragment
	 * matches.
	 */
	async renderModePrompt(data: PromptRenderData): Promise<string> {
		const documents = await this._loadDocuments();
		const mode = data.mode;

		const matching = documents
			.filter(doc => {
				const docMode = doc.metadata.mode;
				return docMode === mode || (mode !== undefined && Array.isArray(docMode) && docMode.includes(mode));
			})
			.sort((a, b) => (a.metadata.order ?? 0) - (b.metadata.order ?? 0));

		if (matching.length === 0) {
			return '';
		}

		const merged = matching.map(doc => doc.content.trim()).join('\n\n');
		return PromptTemplateEngine.render(merged, data);
	}

	/**
	 * Read a single prompt file's raw contents (no frontmatter processing).
	 */
	async readPromptFile(fileName: string): Promise<string> {
		const uri = URI.joinPath(this._promptsDir, fileName);
		const contents = await this._fileService.readFile(uri);
		return contents.value.toString();
	}

	private async _loadDocuments(): Promise<ParsedPromptDocument[]> {
		if (this._documents) {
			return this._documents;
		}

		const documents: ParsedPromptDocument[] = [];
		try {
			const stat = await this._fileService.resolve(this._promptsDir);
			for (const child of stat.children ?? []) {
				if (child.isDirectory || !child.name.endsWith('.md')) {
					continue;
				}
				const contents = await this._fileService.readFile(child.resource);
				documents.push(parsePromptDocument(contents.value.toString()));
			}
		} catch {
			// If the prompt templates can't be read, render nothing rather than
			// failing the whole request.
		}

		this._documents = documents;
		return documents;
	}
}

/**
 * Parse a prompt document into its frontmatter (`mode`, `order`) and body.
 *
 * The frontmatter is a small subset of YAML: `key: value` scalars and `key:`
 * followed by `- item` list entries. Only `mode` and `order` are consumed;
 * other keys (e.g. `description`) are ignored.
 */
function parsePromptDocument(raw: string): ParsedPromptDocument {
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
	if (!match) {
		return { metadata: {}, content: raw };
	}

	const [, frontmatter, content] = match;
	const metadata: PromptFrontmatter = {};
	const modeList: string[] = [];
	let collectingModeList = false;

	for (const line of frontmatter.split(/\r?\n/)) {
		const listItem = line.match(/^\s*-\s*(.+?)\s*$/);
		if (collectingModeList && listItem) {
			modeList.push(listItem[1]);
			continue;
		}

		const entry = line.match(/^(\w+):\s*(.*)$/);
		if (!entry) {
			continue;
		}

		collectingModeList = false;
		const key = entry[1];
		const value = entry[2].trim();
		if (key === 'mode') {
			if (value) {
				metadata.mode = value;
			} else {
				collectingModeList = true;
			}
		} else if (key === 'order') {
			const order = Number(value);
			if (!Number.isNaN(order)) {
				metadata.order = order;
			}
		}
	}

	if (modeList.length > 0) {
		metadata.mode = modeList;
	}

	return { metadata, content };
}
