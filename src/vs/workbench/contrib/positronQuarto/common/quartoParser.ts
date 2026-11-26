/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../../platform/log/common/log.js';
import { parse as parseYaml, YamlNode, YamlMapNode, YamlParseError } from '../../../../base/common/yaml.js';
import {
	QuartoNodeType,
	QuartoSourceLocation,
	QuartoCodeBlock,
	QuartoRawBlock,
	QuartoFrontmatter,
	QuartoDocument,
} from './quartoTypes.js';

/** Matches YAML frontmatter block at the start of a document */
const FRONTMATTER_REGEX = /^---\r?\n(?<content>[\s\S]*?)\r?\n---/;

/** Matches the opening fence of a code block: ```{language options} */
const CODE_START_REGEX = /^```\{(?<language>\w+)(?<options>[^}]*)\}\s*$/;

/** Matches the opening fence of a raw block: ```{=format} */
const RAW_START_REGEX = /^```\{=(?<format>\w+)\}\s*$/;

/** Matches a closing code fence. */
const CODE_END_REGEX = /^```\s*$/;

/**
 * Extracts the block label from chunk options.
 * The label is the first option if it doesn't contain '='.
 */
function extractLabel(options: string): string | undefined {
	if (!options) {
		return undefined;
	}
	const firstOption = options.split(',')[0].trim();
	if (firstOption && !firstOption.includes('=')) {
		return firstOption;
	}
	return undefined;
}

/**
 * Look up a property value by key in a YamlMapNode.
 */
function getObjectProperty(node: YamlMapNode, key: string): YamlNode | undefined {
	for (const prop of node.properties) {
		if (prop.key.value === key) {
			return prop.value;
		}
	}
	return undefined;
}

/**
 * Whether the front matter declares the knitr engine (true) or another one
 * (false), or undefined when it declares none, checked as Quarto and the Quarto
 * extension check it: an `engine` key says which; failing that, a `knitr` key
 * means knitr and a `jupyter` key means Jupyter.
 */
function declaredKnitrEngine(root: YamlMapNode): boolean | undefined {
	const engine = getObjectProperty(root, 'engine');
	if (engine) {
		return engine.type === 'scalar' && engine.value === 'knitr';
	}
	if (getObjectProperty(root, 'knitr')) {
		return true;
	}
	if (getObjectProperty(root, 'jupyter')) {
		return false;
	}
	return undefined;
}

/**
 * Parses YAML frontmatter and extracts the jupyter kernel specification and
 * the declared engine (see {@link declaredKnitrEngine}). Handles both simple
 * form (`jupyter: python3`) and complex form
 * (`jupyter: { kernelspec: { name: ir } }`).
 */
function parseFrontmatter(frontmatterContent: string): { jupyterKernel?: string; knitrEngine?: boolean } {
	const result: { jupyterKernel?: string; knitrEngine?: boolean } = {};

	const errors: YamlParseError[] = [];
	const root = parseYaml(frontmatterContent, errors);
	if (!root || root.type !== 'map') {
		return result;
	}
	// The Quarto extension reads frontmatter with a strict YAML parser, which
	// rejects frontmatter this lenient one only reports errors for (a
	// duplicate key or bad indentation), and then decides as if none were
	// declared; so does this. What this parser reads past without an error
	// (a tab-indented key, `a: b: c`) it still reads, where the extension
	// would not.
	if (errors.length === 0) {
		result.knitrEngine = declaredKnitrEngine(root);
	}

	const jupyter = getObjectProperty(root, 'jupyter');
	if (!jupyter) {
		return result;
	}

	// Simple form: jupyter: python3
	if (jupyter.type === 'scalar') {
		result.jupyterKernel = jupyter.value;
		return result;
	}

	// Complex form: jupyter: { kernelspec: { name: kernel_name } }
	if (jupyter.type === 'map') {
		const kernelspec = getObjectProperty(jupyter, 'kernelspec');
		if (kernelspec?.type === 'map') {
			const name = getObjectProperty(kernelspec, 'name');
			if (name?.type === 'scalar') {
				result.jupyterKernel = name.value;
			}
		}
	}

	return result;
}

/** Mutable state tracked while a code block is open. */
interface OpenCodeBlock {
	type: QuartoNodeType.CodeBlock;
	language: string;
	options: string;
	startLine: number;
}

/** Mutable state tracked while a raw block is open. */
interface OpenRawBlock {
	type: QuartoNodeType.RawBlock;
	format: string;
	startLine: number;
}

type OpenBlock = OpenCodeBlock | OpenRawBlock;

/** Parse QMD content. */
export function parseQuarto(content: string, logService?: ILogService): QuartoDocument {
	const lines = content.split(/\r?\n/);
	const blocks: (QuartoCodeBlock | QuartoRawBlock)[] = [];

	if (lines.length === 0) {
		return { blocks, lines };
	}

	let frontmatter: QuartoFrontmatter | undefined;
	let lineIndex = 0;

	// Step 1: Extract frontmatter
	const frontmatterMatch = content.match(FRONTMATTER_REGEX);
	if (frontmatterMatch?.groups) {
		const rawContent = frontmatterMatch[0];
		const frontmatterLineCount = rawContent.split(/\r?\n/).length;
		let jupyterKernel: string | undefined;
		let knitrEngine: boolean | undefined;

		try {
			const parsed = parseFrontmatter(frontmatterMatch.groups.content);
			jupyterKernel = parsed.jupyterKernel;
			knitrEngine = parsed.knitrEngine;
		} catch (e) {
			logService?.warn('Failed to parse Quarto frontmatter', e);
		}

		const location: QuartoSourceLocation = {
			begin: { line: 0 },
			end: { line: frontmatterLineCount - 1 },
		};
		frontmatter = { rawContent, jupyterKernel, knitrEngine, location };
		lineIndex = frontmatterLineCount;
	}

	// Step 2: Scan for code blocks and raw blocks.
	let current: OpenBlock | null = null;

	for (let i = lineIndex; i < lines.length; i++) {
		const line = lines[i];
		const lineNum = i; // 0-based line index

		if (!current) {
			const codeBlock = line.match(CODE_START_REGEX)?.groups;
			if (codeBlock) {
				current = {
					type: QuartoNodeType.CodeBlock,
					language: codeBlock.language.toLowerCase(),
					options: codeBlock.options.trim(),
					startLine: lineNum,
				};
				continue;
			}

			const rawBlock = line.match(RAW_START_REGEX)?.groups;
			if (rawBlock) {
				current = {
					type: QuartoNodeType.RawBlock,
					format: rawBlock.format.toLowerCase(),
					startLine: lineNum,
				};
			}
		} else if (CODE_END_REGEX.test(line)) {
			const content = lines.slice(current.startLine + 1, lineNum).join('\n');
			const location: QuartoSourceLocation = {
				begin: { line: current.startLine },
				end: { line: lineNum },
			};
			if (current.type === QuartoNodeType.CodeBlock) {
				blocks.push({
					type: QuartoNodeType.CodeBlock,
					location,
					content,
					language: current.language,
					label: extractLabel(current.options),
					options: current.options,
				});
			} else {
				blocks.push({
					type: QuartoNodeType.RawBlock,
					location,
					content,
					format: current.format,
				});
			}
			current = null;
		}
	}

	return { blocks, frontmatter, lines };
}

/** Maps common Jupyter kernel names to language identifiers. */
export function kernelToLanguageId(kernelName: string): string | undefined {
	const kernelLower = kernelName.toLowerCase();
	if (kernelLower.includes('python')) {
		return 'python';
	}
	if (kernelLower === 'ir' || kernelLower === 'r' || kernelLower === 'ark') {
		return 'r';
	}
	if (kernelLower.includes('julia')) {
		return 'julia';
	}
	if (kernelLower.startsWith('ggsql')) {
		return 'ggsql';
	}
	return undefined;
}
