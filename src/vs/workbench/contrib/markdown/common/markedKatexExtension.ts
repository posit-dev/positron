/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type * as marked from '../../../../base/common/marked/marked.js';
import { htmlAttributeEncodeValue } from '../../../../base/common/strings.js';

export const mathInlineRegExp = /(?<![a-zA-Z0-9])(?<dollars>\${1,2})(?!\.|\(["'])((?:\\.|[^\\\n])*?(?:\\.|[^\\\n\$]))\k<dollars>(?![a-zA-Z0-9])/; // Non-standard, but ensure opening $ is not preceded and closing $ is not followed by word/number characters, opening $ not followed by ., (", ('
export const katexContainerClassName = 'vscode-katex-container';
export const katexContainerLatexAttributeName = 'data-latex';

const inlineRule = new RegExp('^' + mathInlineRegExp.source);

export namespace MarkedKatexExtension {
	type KatexOptions = import('katex').KatexOptions;

	// From https://github.com/UziTech/marked-katex-extension/blob/main/src/index.js
	// From https://github.com/UziTech/marked-katex-extension/blob/main/src/index.js
	export interface MarkedKatexOptions extends KatexOptions { }

	// --- Start Positron ---
	// Token structure for KaTeX inline and block math expressions.
	// Exported for use by token-based React renderers.
	export interface KatexToken {
		type: 'inlineKatex' | 'blockKatex';
		raw: string;
		text: string;
		displayMode: boolean;
	}
	// --- End Positron ---

	const blockRule = /^(\${1,2})\n((?:\\[^]|[^\\])+?)\n\1(?:\n|$)/;
	const bareBlockStartRule = /^\\begin\s*\{([^{}]+)\}/;
	const BLOCK_KATEX_TOKEN = 'blockKatex' as const;

	export function extension(katex: typeof import('katex').default, options: MarkedKatexOptions = {}): marked.MarkedExtension {
		return {
			extensions: [
				inlineKatex(options, createRenderer(katex, options, false)),
				blockKatex(options, createRenderer(katex, options, true)),
				bareBlockKatex(options, createRenderer(katex, options, true)),
				inlineBareKatex(options, createRenderer(katex, options, true)),
			],
		};
	}

	function createRenderer(katex: typeof import('katex').default, options: MarkedKatexOptions, isBlock: boolean): marked.RendererExtensionFunction {
		return (token: marked.Tokens.Generic) => {
			let out: string;
			try {
				const html = katex.renderToString(token.text, {
					...options,
					throwOnError: true,
					displayMode: token.displayMode,
				});

				// Wrap in a container with attribute as a fallback for extracting the original LaTeX source
				// This ensures we can always retrieve the source even if the annotation element is not present
				out = `<span class="${katexContainerClassName}" ${katexContainerLatexAttributeName}="${htmlAttributeEncodeValue(token.text)}">${html}</span>`;
			} catch {
				// On failure, just use the original text including the wrapping $ or $$
				out = token.raw;
			}
			return out + (isBlock ? '\n' : '');
		};
	}

	function inlineKatex(options: MarkedKatexOptions, renderer: marked.RendererExtensionFunction): marked.TokenizerAndRendererExtension {
		const ruleReg = inlineRule;
		return {
			name: 'inlineKatex',
			level: 'inline',
			start(src: string) {
				let index;
				let indexSrc = src;

				while (indexSrc) {
					index = indexSrc.indexOf('$');
					if (index === -1) {
						return;
					}

					const possibleKatex = indexSrc.substring(index);
					if (possibleKatex.match(ruleReg)) {
						return index;
					}

					indexSrc = indexSrc.substring(index + 1).replace(/^\$+/, '');
				}
				return;
			},
			tokenizer(src: string, tokens: marked.Token[]) {
				const match = src.match(ruleReg);
				if (match) {
					return {
						type: 'inlineKatex',
						raw: match[0],
						text: match[2].trim(),
						displayMode: match[1].length === 2,
					};
				}
				return;
			},
			renderer,
		};
	}

	function blockKatex(options: MarkedKatexOptions, renderer: marked.RendererExtensionFunction): marked.TokenizerAndRendererExtension {
		return {
			name: BLOCK_KATEX_TOKEN,
			level: 'block',
			start(src: string) {
				return src.match(new RegExp(blockRule.source, 'm'))?.index;
			},
			tokenizer(src: string, tokens: marked.Token[]) {
				const match = src.match(blockRule);
				if (match) {
					return {
						type: BLOCK_KATEX_TOKEN,
						raw: match[0],
						text: match[2].trim(),
						displayMode: match[1].length === 2,
					};
				}
				return;
			},
			renderer,
		};
	}

	/**
	 * Finds the end position of a balanced \begin{env}...\end{env} block.
	 * Returns the character index immediately after the closing \end{env}
	 * (plus trailing newline when at a line boundary), or -1 if unbalanced.
	 */
	function findBareBlockEnd(src: string): number {
		const beginEndStack: string[] = [];
		const rule = /(\\begin|\\end)\s*\{([^{}]+)\}/g;
		let match: RegExpExecArray | null;

		while ((match = rule.exec(src)) !== null) {
			if (match[1] === '\\begin') {
				beginEndStack.push(match[2].trim());
			} else if (match[1] === '\\end') {
				beginEndStack.pop();
				if (beginEndStack.length === 0) {
					let end = match.index + match[0].length;
					if (src[end] === '\n') {
						end += 1;
					}
					return end;
				}
			}
		}
		return -1;
	}

	function tokenizeBareBlock(src: string): marked.Tokens.Generic | undefined {
		if (!bareBlockStartRule.test(src)) {
			return;
		}

		const end = findBareBlockEnd(src);
		if (end === -1) {
			return;
		}

		const raw = src.slice(0, end);
		return {
			type: BLOCK_KATEX_TOKEN,
			raw,
			text: raw.trim(),
			displayMode: true,
		};
	}

	function bareBlockKatex(options: MarkedKatexOptions, renderer: marked.RendererExtensionFunction): marked.TokenizerAndRendererExtension {
		return {
			name: BLOCK_KATEX_TOKEN,
			level: 'block',
			start(src: string) {
				return src.match(bareBlockStartRule)?.index;
			},
			tokenizer(src: string) {
				return tokenizeBareBlock(src);
			},
			renderer,
		};
	}

	function inlineBareKatex(options: MarkedKatexOptions, renderer: marked.RendererExtensionFunction): marked.TokenizerAndRendererExtension {
		return {
			name: BLOCK_KATEX_TOKEN,
			level: 'inline',
			start(src: string) {
				return src.indexOf('\\begin');
			},
			tokenizer(src: string) {
				return tokenizeBareBlock(src);
			},
			renderer,
		};
	}
}
