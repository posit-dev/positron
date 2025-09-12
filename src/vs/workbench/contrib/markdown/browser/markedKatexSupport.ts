/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { importAMDNodeModule, resolveAmdNodeModulePath } from '../../../../amdX.js';
import { MarkdownSanitizerConfig } from '../../../../base/browser/markdownRenderer.js';
import { CodeWindow } from '../../../../base/browser/window.js';
import { Lazy } from '../../../../base/common/lazy.js';
import type * as marked from '../../../../base/common/marked/marked.js';

export class MarkedKatexSupport {

	public static getSanitizerOptions(baseConfig: {
		readonly allowedTags: readonly string[];
		readonly allowedAttributes: readonly string[];
	}): MarkdownSanitizerConfig {
		return {
			allowedTags: {
				override: [
					...baseConfig.allowedTags,
					...trustedMathMlTags,
				]
			},
			customAttrSanitizer: (attrName, attrValue) => {
				if (attrName === 'class') {
					return true; // TODO: allows all classes for now since we don't have a list of possible katex classes
				} else if (attrName === 'style') {
					return this.sanitizeKatexStyles(attrValue);
				}

				return baseConfig.allowedAttributes.includes(attrName);
			},
		};
	}

	private static tempSanitizerRule = new Lazy(() => {
		// Create a CSSStyleDeclaration object via a style sheet rule
		const styleSheet = new CSSStyleSheet();
		styleSheet.insertRule(`.temp{}`);
		const rule = styleSheet.cssRules[0];
		if (!(rule instanceof CSSStyleRule)) {
			throw new Error('Invalid CSS rule');
		}
		return rule.style;
	});

	private static sanitizeStyles(styleString: string, allowedProperties: readonly string[]): string {
		const style = this.tempSanitizerRule.value;
		style.cssText = styleString;

		const sanitizedProps = [];

		for (let i = 0; i < style.length; i++) {
			const prop = style[i];
			if (allowedProperties.includes(prop)) {
				const value = style.getPropertyValue(prop);
				// Allow through lists of numbers with units or bare words like 'block'
				// Main goal is to block things like 'url()'.
				if (/^(([\d\.\-]+\w*\s?)+|\w+)$/.test(value)) {
					sanitizedProps.push(`${prop}: ${value}`);
				}
			}
		}

		return sanitizedProps.join('; ');
	}

	private static sanitizeKatexStyles(styleString: string): string {
		const allowedProperties = [
			'display',
			'position',
			'font-family',
			'font-style',
			'font-weight',
			'font-size',
			'height',
			'min-height',
			'max-height',
			'width',
			'min-width',
			'max-width',
			'margin',
			'margin-top',
			'margin-right',
			'margin-bottom',
			'margin-left',
			'padding',
			'padding-top',
			'padding-right',
			'padding-bottom',
			'padding-left',
			'top',
			'left',
			'right',
			'bottom',
			'vertical-align',
			'transform',
			'border',
			'border-top-width',
			'border-right-width',
			'border-bottom-width',
			'border-left-width',
			'color',
			'white-space',
			'text-align',
			'line-height',
			'float',
			'clear',
		];
		return this.sanitizeStyles(styleString, allowedProperties);
	}

	private static _katex?: typeof import('katex').default;
	private static _katexPromise = new Lazy(async () => {
		this._katex = await importAMDNodeModule('katex', 'dist/katex.min.js');
		return this._katex;
	});

	public static getExtension(window: CodeWindow, options: MarkedKatexExtension.MarkedKatexOptions = {}): marked.MarkedExtension | undefined {
		if (!this._katex) {
			return undefined;
		}

		this.ensureKatexStyles(window);
		return MarkedKatexExtension.extension(this._katex, options);
	}

	public static async loadExtension(window: CodeWindow, options: MarkedKatexExtension.MarkedKatexOptions = {}): Promise<marked.MarkedExtension> {
		const katex = await this._katexPromise.value;
		this.ensureKatexStyles(window);
		return MarkedKatexExtension.extension(katex, options);
	}

	public static ensureKatexStyles(window: CodeWindow) {
		const doc = window.document;
		if (!doc.querySelector('link.katex')) {
			const katexStyle = document.createElement('link');
			katexStyle.classList.add('katex');
			katexStyle.rel = 'stylesheet';
			katexStyle.href = resolveAmdNodeModulePath('katex', 'dist/katex.min.css');
			doc.head.appendChild(katexStyle);
		}
	}
}


export namespace MarkedKatexExtension {
	type KatexOptions = import('katex').KatexOptions;

	// From https://github.com/UziTech/marked-katex-extension/blob/main/src/index.js
	// From https://github.com/UziTech/marked-katex-extension/blob/main/src/index.js
	export interface MarkedKatexOptions extends KatexOptions { }

	const inlineRule = /^(\${1,2})(?!\$)((?:\\.|[^\\\n])*?(?:\\.|[^\\\n\$]))\1(?=[\s?!\.,:'\uff1f\uff01\u3002\uff0c\uff1a']|$)/;
	const inlineRuleNonStandard = /^(\${1,2})(?!\$)((?:\\.|[^\\\n])*?(?:\\.|[^\\\n\$]))\1/; // Non-standard, even if there are no spaces before and after $ or $$, try to parse

	const blockRule = /^(\${1,2})\n((?:\\[^]|[^\\])+?)\n\1(?:\n|$)/;

	export function extension(katex: typeof import('katex').default, options: MarkedKatexOptions = {}): marked.MarkedExtension {
		return {
			extensions: [
				inlineKatex(options, createRenderer(katex, options, false)),
				blockKatex(options, createRenderer(katex, options, true)),
			],
		};
	}

	function createRenderer(katex: typeof import('katex').default, options: MarkedKatexOptions, isBlock: boolean): marked.RendererExtensionFunction {
		return (token: marked.Tokens.Generic) => {
			let out: string;
			try {
				out = katex.renderToString(token.text, {
					...options,
					throwOnError: true,
					displayMode: token.displayMode,
				});
			} catch {
				// On failure, just use the original text including the wrapping $ or $$
				out = token.raw;
			}
			return out + (isBlock ? '\n' : '');
		};
	}

	function inlineKatex(options: MarkedKatexOptions, renderer: marked.RendererExtensionFunction): marked.TokenizerAndRendererExtension {
		const nonStandard = true;
		const ruleReg = nonStandard ? inlineRuleNonStandard : inlineRule;
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
					const f = nonStandard ? index > -1 : index === 0 || indexSrc.charAt(index - 1) === ' ';
					if (f) {
						const possibleKatex = indexSrc.substring(index);

						if (possibleKatex.match(ruleReg)) {
							return index;
						}
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
			name: 'blockKatex',
			level: 'block',
			start(src: string) {
				return src.match(new RegExp(blockRule.source, 'm'))?.index;
			},
			tokenizer(src: string, tokens: marked.Token[]) {
				const match = src.match(blockRule);
				if (match) {
					return {
						type: 'blockKatex',
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
}
const trustedMathMlTags = Object.freeze([
	'semantics',
	'annotation',
	'math',
	'menclose',
	'merror',
	'mfenced',
	'mfrac',
	'mglyph',
	'mi',
	'mlabeledtr',
	'mmultiscripts',
	'mn',
	'mo',
	'mover',
	'mpadded',
	'mphantom',
	'mroot',
	'mrow',
	'ms',
	'mspace',
	'msqrt',
	'mstyle',
	'msub',
	'msup',
	'msubsup',
	'mtable',
	'mtd',
	'mtext',
	'mtr',
	'munder',
	'munderover',
	'mprescripts',

	// svg tags
	'svg',
	'altglyph',
	'altglyphdef',
	'altglyphitem',
	'circle',
	'clippath',
	'defs',
	'desc',
	'ellipse',
	'filter',
	'font',
	'g',
	'glyph',
	'glyphref',
	'hkern',
	'line',
	'lineargradient',
	'marker',
	'mask',
	'metadata',
	'mpath',
	'path',
	'pattern',
	'polygon',
	'polyline',
	'radialgradient',
	'rect',
	'stop',
	'style',
	'switch',
	'symbol',
	'text',
	'textpath',
	'title',
	'tref',
	'tspan',
	'view',
	'vkern',
]);

