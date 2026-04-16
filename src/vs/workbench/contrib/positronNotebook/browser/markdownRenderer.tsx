/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import * as marked from '../../../../base/common/marked/marked.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { tokenizeToString } from '../../../../editor/common/languages/textToHtmlTokenizer.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { slugify } from '../../markdown/browser/markedGfmHeadingIdPlugin.js';
import { MarkedKatexSupport } from '../../markdown/browser/markedKatexSupport.js';
import { getWindow } from '../../../../base/browser/dom.js';
import { escape } from '../../../../base/common/strings.js';
import { DeferredImage } from './notebookCells/DeferredImage.js';
import { NotebookLink } from './notebookCells/NotebookLink.js';
import { safeSetInnerHtml } from '../../../../base/browser/domSanitize.js';
import { allowedMarkdownHtmlTags, allowedMarkdownHtmlAttributes } from '../../../../base/browser/markdownRenderer.js';
import { importAMDNodeModule } from '../../../../amdX.js';
import { convertDomChildrenToReact } from './domToReact.js';
import { MarkedKatexExtension } from '../../markdown/common/markedKatexExtension.js';
import { MarkedSuperSubExtension } from '../../markdown/common/markedSuperSubExtension.js';
import { MarkedFootnoteExtension } from '../../markdown/common/markedFootnoteExtension.js';

/**
 * Decodes HTML entities in a string
 */
function decodeHtmlEntities(text: string): string {
	const entities: { [key: string]: string } = {
		'&quot;': '"',
		'&#34;': '"',
		// eslint-disable-next-line local/code-no-unexternalized-strings
		'&apos;': "'",
		// eslint-disable-next-line local/code-no-unexternalized-strings
		'&#39;': "'",
		'&amp;': '&',
		'&lt;': '<',
		'&gt;': '>',
		'&nbsp;': '\u00A0',
	};

	return text.replace(/&(?:#\d+|#x[\da-fA-F]+|[a-zA-Z]+);/g, (match) => {
		// Check for named entities first
		if (entities[match]) {
			return entities[match];
		}

		// Handle numeric entities (&#34; or &#x22;)
		if (match.startsWith('&#x')) {
			const code = parseInt(match.slice(3, -1), 16);
			return String.fromCharCode(code);
		} else if (match.startsWith('&#')) {
			const code = parseInt(match.slice(2, -1), 10);
			return String.fromCharCode(code);
		}

		// If we don't recognize it, return as-is
		return match;
	});
}

/**
 * Type that supports both Marked tokens and KaTeX "tokens"
 * for the purposes of rendering.
 *
 * KatexToken is created by MarkedKatexExtension.ts which
 * parses LaTeX math expressions and creates these tokens.
 */
type ExtendedToken = marked.Token | MarkedKatexExtension.KatexToken | MarkedSuperSubExtension.SuperSubToken | MarkedFootnoteExtension.FootnoteToken;

/**
 * Component that renders LaTeX expressions.
 *
 * Since rendering LaTeX to HTML requires KaTeX which produces
 * HTML/MathML/SVG, we need to use safeSetInnerHtml to render it
 * which will parse the HTML string into the DOM.
 *
 * @param latex The raw LaTeX string to render
 * @param displayMode Whether to render in display mode block or inline mode (default)
 * @returns React element containing the rendered math
 */
function KatexMath({ latex, displayMode }: { latex: string; displayMode?: boolean }) {
	const containerRef = React.useRef<HTMLSpanElement | HTMLDivElement>(null);

	React.useEffect(() => {
		const container = containerRef.current;
		if (!container) {
			return;
		}

		let cancelled = false;

		// Load KaTeX dynamically using AMD module loader
		importAMDNodeModule<typeof import('katex').default>('katex', 'dist/katex.min.js').then(katex => {
			if (cancelled) {
				return;
			}

			try {
				// convert the raw latex into HTML/MathML/SVG
				const html = katex.renderToString(latex, {
					throwOnError: false,
					displayMode: displayMode || false
				});
				const sanitizerConfig = MarkedKatexSupport.getSanitizerOptions({
					allowedTags: allowedMarkdownHtmlTags,
					allowedAttributes: allowedMarkdownHtmlAttributes,
				});
				// Parse the HTML into the container element safely
				safeSetInnerHtml(container, html, sanitizerConfig);
			} catch (e) {
				container.textContent = latex; // Fallback to raw LaTeX on error
			}
		}).catch((err) => {
			if (!cancelled) {
				if (container) {
					container.textContent = latex; // Fallback to raw LaTeX on error
				}
			}
		});

		return () => {
			cancelled = true;
		};
	}, [latex, displayMode]);

	// KaTeX will populate this container with its rendered output
	if (displayMode) {
		return <div ref={containerRef as React.RefObject<HTMLDivElement>} className='katex-block' />;
	}
	return <span ref={containerRef as React.RefObject<HTMLSpanElement>} className='katex-inline' />;
}

/**
 * Component that renders syntax-highlighted code blocks.
 *
 * Since we don't have a way to directly create a react element, we
 * take the raw code string and use the language service to get the
 * syntax-highlighted HTML, then render that via safeSetInnerHtml.
 *
 * @param code The raw code string to highlight
 * @param lang The language identifier (e.g., 'javascript', 'python')
 * @param extensionService Extension service for loading language extensions
 * @param languageService Language service for syntax highlighting
 * @returns React element containing the syntax-highlighted code block
 */
function SyntaxHighlightedCode({
	code,
	lang,
	extensionService,
	languageService
}: {
	code: string;
	lang?: string;
	extensionService: IExtensionService;
	languageService: ILanguageService;
}) {
	const codeRef = React.useRef<HTMLElement>(null);

	React.useEffect(() => {
		const codeElement = codeRef.current;
		if (!codeElement) {
			return;
		}

		if (!lang) {
			codeElement.textContent = code;
			return;
		}

		let cancelled = false;

		(async () => {
			await extensionService.whenInstalledExtensionsRegistered();

			if (cancelled) {
				return;
			}

			const languageId = languageService.getLanguageIdByLanguageName(lang)
				?? languageService.getLanguageIdByLanguageName(lang.split(/\s+|:|,|(?!^)\{|\?]/, 1)[0]);

			// Get the syntax-highlighted HTML string
			const highlighted = await tokenizeToString(languageService, code, languageId);
			if (!cancelled && codeElement) {
				const sanitizerConfig = MarkedKatexSupport.getSanitizerOptions({
					allowedTags: allowedMarkdownHtmlTags,
					allowedAttributes: allowedMarkdownHtmlAttributes,
				});
				// Parse the HTML into the container element safely
				safeSetInnerHtml(codeElement, highlighted, sanitizerConfig);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [code, lang, extensionService, languageService]);

	return (
		<pre>
			<code
				ref={codeRef}
				className={lang ? `language-${escape(lang)}` : undefined}
			/>
		</pre>
	);
}

/**
 * Component that renders raw HTML safely with component overrides.
 *
 * Process:
 * 1. Sanitizes HTML using safeSetInnerHtml with style rules for notebooks
 * 2. Converts DOM nodes to React elements via convertDomChildrenToReact
 * 3. Applies component overrides: <img> → DeferredImage, <a> → NotebookLink
 * 4. Wraps result in div for CSS targeting of raw HTML content
 *
 * @param html The raw HTML string to render
 * @returns React element wrapped in .raw-html-content div
 */
function RawHtml({ html }: { html: string }) {
	const reactElements = React.useMemo(() => {
		// Filter out the restrictive style rule from allowed markdown attributes list
		const baseAttributes = allowedMarkdownHtmlAttributes.filter(attr =>
			typeof attr === 'string' || attr.attributeName !== 'style'
		);

		// Configure sanitizer to allow remote images, local links, and inline styles
		const notebookSanitizerConfig = {
			allowedTags: {
				override: allowedMarkdownHtmlTags
			},
			allowedAttributes: {
				override: [
					...baseAttributes,
					'id',  // Allow id attribute for anchor link targets
					'style' // Allow style attribute for inline styles
				]
			},
			allowedLinkProtocols: {
				override: ['http', 'https'] as readonly string[]
			},
			allowedMediaProtocols: {
				override: ['http', 'https', 'data'] as readonly string[]
			},
			allowRelativeLinkPaths: true,
			allowRelativeMediaPaths: true
		};

		const tempContainer = document.createElement('div');
		// Parse the HTML into the container element safely
		safeSetInnerHtml(tempContainer, html, notebookSanitizerConfig);
		// Convert DOM to React with component overrides.
		// This ensures that <img> tags become DeferredImage components
		// and <a> tags become NotebookLink components.
		return convertDomChildrenToReact(
			tempContainer,
			{
				img: DeferredImage,
				a: NotebookLink,
			}
		);
	}, [html]);

	// Wrap in div for CSS targeting to prevent overflow issues with raw HTML content
	return <div className='raw-html-content'>{reactElements}</div>;
}

/**
 * Renderer that converts Marked tokens to React elements.
 * Uses component overrides to handle special cases (complex HTML):
 * - Links: NotebookLink
 * - Images: DeferredImage
 * - Raw HTML: RawHtml with component overrides for links/images
 * - LaTeX math: KatexMath
 * - Syntax-highlighted code blocks: SyntaxHighlightedCode
 */
export class TokenMarkdownRenderer {
	private keyCounter = 0;
	private slugCounter = new Map<string, number>();
	private _footnoteNumberMap = new Map<string, number>();
	private _footnoteRefCounter = new Map<string, number>();
	private _footnoteSafeIdMap = new Map<string, string>();

	constructor(
		private extensionService: IExtensionService,
		private languageService: ILanguageService
	) { }

	/**
	 * Renders an array of tokens to React elements.
	 * Footnote definitions are collected and appended as a grouped section at the end.
	 */
	render(tokens: ExtendedToken[]): React.ReactElement[] {
		// First pass: walk the token tree to build footnote numbering and
		// collision-safe anchor IDs for cross-token references.
		const footnoteDefinitions = this.collectFootnoteContext(tokens);

		// Second pass: render all tokens. Definition tokens produce empty
		// fragments since they are grouped into the section appended below.
		const elements = tokens.map((token, i) => this.renderToken(token, `token-${i}`));

		if (footnoteDefinitions.length > 0) {
			elements.push(this.renderFootnoteSection(footnoteDefinitions));
		}

		return elements;
	}

	/**
	 * Walks the token tree to gather every footnote ID (refs and definitions),
	 * deduplicates definitions (first-wins), and populates the instance maps
	 * used by renderFootnoteRef/renderFootnoteSection:
	 *   - _footnoteSafeIdMap: raw id -> collision-safe DOM id
	 *   - _footnoteNumberMap: raw id -> sequential footnote number
	 *   - _footnoteRefCounter: reset here, incremented during rendering
	 *
	 * Returns the deduplicated definitions in source order.
	 */
	private collectFootnoteContext(tokens: ExtendedToken[]): MarkedFootnoteExtension.FootnoteDefinitionToken[] {
		const allIds: string[] = [];
		const seenRawIds = new Set<string>();
		const seenDefIds = new Set<string>();
		const footnoteDefinitions: MarkedFootnoteExtension.FootnoteDefinitionToken[] = [];

		const collectId = (id: string) => {
			if (!seenRawIds.has(id)) {
				seenRawIds.add(id);
				allIds.push(id);
			}
		};

		const walk = (tokenList: ExtendedToken[]) => {
			for (const token of tokenList) {
				if (token.type === 'footnoteDefinition') {
					const def = token as MarkedFootnoteExtension.FootnoteDefinitionToken;
					collectId(def.id);
					if (!seenDefIds.has(def.id)) {
						seenDefIds.add(def.id);
						footnoteDefinitions.push(def);
					}
				} else if (token.type === 'footnoteRef') {
					collectId((token as MarkedFootnoteExtension.FootnoteRefToken).id);
				}
				// Recurse into child tokens (paragraphs, headings, lists, emphasis, etc.)
				const generic = token as { tokens?: ExtendedToken[]; items?: ExtendedToken[] };
				if (generic.tokens) {
					walk(generic.tokens);
				}
				if (generic.items) {
					walk(generic.items);
				}
				// Table tokens store inline content in header/row cells.
				if (token.type === 'table') {
					const table = token as marked.Tokens.Table;
					for (const cell of table.header) {
						walk(cell.tokens as ExtendedToken[]);
					}
					for (const row of table.rows) {
						for (const cell of row) {
							walk(cell.tokens as ExtendedToken[]);
						}
					}
				}
			}
		};

		walk(tokens);

		this._footnoteNumberMap = new Map();
		this._footnoteRefCounter = new Map();
		this._footnoteSafeIdMap = new Map();

		const usedSafeIds = new Set<string>();
		for (const id of allIds) {
			let safeId = id.replace(/[^\w-]/g, '-');
			if (usedSafeIds.has(safeId)) {
				let suffix = 2;
				while (usedSafeIds.has(`${safeId}-${suffix}`)) {
					suffix++;
				}
				safeId = `${safeId}-${suffix}`;
			}
			usedSafeIds.add(safeId);
			this._footnoteSafeIdMap.set(id, safeId);
		}

		for (let i = 0; i < footnoteDefinitions.length; i++) {
			this._footnoteNumberMap.set(footnoteDefinitions[i].id, i + 1);
		}

		return footnoteDefinitions;
	}

	/**
	 * Renders a single token to a React element
	 */
	private renderToken(token: ExtendedToken, key: string): React.ReactElement {
		switch (token.type) {
			case 'space':
				return <React.Fragment key={key} />;
			case 'code':
				return this.renderCode(token as marked.Tokens.Code, key);
			case 'heading':
				return this.renderHeading(token as marked.Tokens.Heading, key);
			case 'table':
				return this.renderTable(token as marked.Tokens.Table, key);
			case 'hr':
				return <hr key={key} />;
			case 'blockquote':
				return this.renderBlockquote(token as marked.Tokens.Blockquote, key);
			case 'list':
				return this.renderList(token as marked.Tokens.List, key);
			case 'list_item':
				return this.renderListItem(token as marked.Tokens.ListItem, key);
			case 'paragraph':
				return this.renderParagraph(token as marked.Tokens.Paragraph, key);
			case 'html':
				return this.renderHtml(token as marked.Tokens.HTML, key);
			case 'text':
				return this.renderText(token as marked.Tokens.Text, key);
			case 'br':
				return <br key={key} />;
			case 'escape':
				return <React.Fragment key={key}>{decodeHtmlEntities((token as marked.Tokens.Escape).text)}</React.Fragment>;
			case 'link':
				return this.renderLink(token as marked.Tokens.Link, key);
			case 'image':
				return this.renderImage(token as marked.Tokens.Image, key);
			case 'strong':
				return this.renderStrong(token as marked.Tokens.Strong, key);
			case 'em':
				return this.renderEm(token as marked.Tokens.Em, key);
			case 'codespan':
				return <code key={key}>{decodeHtmlEntities((token as marked.Tokens.Codespan).text)}</code>;
			case 'del':
				return this.renderDel(token as marked.Tokens.Del, key);
			// Custom superscript/subscript tokens
			case 'superscript':
				return <sup key={key}>{this.renderInlineTokens((token as MarkedSuperSubExtension.SuperSubToken).tokens)}</sup>;
			case 'subscript':
				return <sub key={key}>{this.renderInlineTokens((token as MarkedSuperSubExtension.SuperSubToken).tokens)}</sub>;
			// Custom KaTeX tokens
			case 'inlineKatex':
			case 'blockKatex':
				return this.renderKatex(token as MarkedKatexExtension.KatexToken, key);
			// Custom footnote tokens
			case 'footnoteRef':
				return this.renderFootnoteRef(token as MarkedFootnoteExtension.FootnoteRefToken, key);
			case 'footnoteDefinition':
				// Definitions are collected and rendered as a group by render().
				return <React.Fragment key={key} />;
			default:
				// Handle unknown token types gracefully
				return <React.Fragment key={key} />;
		}
	}

	private renderCode(token: marked.Tokens.Code, key: string): React.ReactElement {
		// Render syntax-highlighted code blocks
		return (
			<SyntaxHighlightedCode
				key={key}
				code={token.text}
				extensionService={this.extensionService}
				lang={token.lang}
				languageService={this.languageService}
			/>
		);
	}

	private renderHeading(token: marked.Tokens.Heading, key: string): React.ReactElement {
		const children = this.renderInlineTokens(token.tokens);
		const HeadingTag = `h${token.depth}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

		// Generate slugified ID for anchor links
		const headingText = this.extractTextFromTokens(token.tokens);
		let slug = slugify(headingText);

		// Handle duplicate headings
		const existingCount = this.slugCounter.get(slug);
		if (existingCount !== undefined) {
			this.slugCounter.set(slug, existingCount + 1);
			slug = slug + '-' + (existingCount + 1);
		} else {
			this.slugCounter.set(slug, 0);
		}

		const id = slug.length > 0 ? slug : undefined;

		return <HeadingTag key={key} id={id}>{children}</HeadingTag>;
	}

	private renderTable(token: marked.Tokens.Table, key: string): React.ReactElement {
		const header = (
			<thead>
				<tr>
					{token.header.map((cell, i) => (
						<th key={`th-${i}`} style={{ textAlign: token.align[i] || undefined }}>
							{this.renderInlineTokens(cell.tokens)}
						</th>
					))}
				</tr>
			</thead>
		);

		const body = (
			<tbody>
				{token.rows.map((row, i) => (
					<tr key={`tr-${i}`}>
						{row.map((cell, j) => (
							<td key={`td-${j}`} style={{ textAlign: token.align[j] || undefined }}>
								{this.renderInlineTokens(cell.tokens)}
							</td>
						))}
					</tr>
				))}
			</tbody>
		);

		return <table key={key}>{header}{body}</table>;
	}

	private renderBlockquote(token: marked.Tokens.Blockquote, key: string): React.ReactElement {
		const children = token.tokens.map((t, i) => this.renderToken(t, `bq-${i}`));
		return <blockquote key={key}>{children}</blockquote>;
	}

	private renderList(token: marked.Tokens.List, key: string): React.ReactElement {
		const children = token.items.map((item, i) => this.renderListItem(item, `li-${i}`));
		if (token.ordered) {
			const start = typeof token.start === 'number' && token.start !== 1 ? token.start : undefined;
			return <ol key={key} start={start}>{children}</ol>;
		}
		return <ul key={key}>{children}</ul>;
	}

	private renderListItem(token: marked.Tokens.ListItem, key: string): React.ReactElement {
		const children = token.tokens.map((t, i) => this.renderToken(t, `li-child-${i}`));

		if (token.task) {
			return (
				<li key={key}>
					<input disabled readOnly checked={token.checked} type='checkbox' />
					{' '}
					{children}
				</li>
			);
		}

		return <li key={key}>{children}</li>;
	}

	private renderParagraph(token: marked.Tokens.Paragraph, key: string): React.ReactElement {
		const children = this.renderInlineTokens(token.tokens);
		return <p key={key}>{children}</p>;
	}

	private renderHtml(token: marked.Tokens.HTML, key: string): React.ReactElement {
		return <RawHtml key={key} html={token.text} />;
	}

	private renderText(token: marked.Tokens.Text, key: string): React.ReactElement {
		if (token.tokens && token.tokens.length > 0) {
			// Text token with nested tokens (e.g., inline formatting)
			const children = this.renderInlineTokens(token.tokens);
			return <React.Fragment key={key}>{children}</React.Fragment>;
		}
		// Decode HTML entities in text
		return <React.Fragment key={key}>{decodeHtmlEntities(token.text)}</React.Fragment>;
	}

	private renderStrong(token: marked.Tokens.Strong, key: string): React.ReactElement {
		const children = this.renderInlineTokens(token.tokens);
		return <strong key={key}>{children}</strong>;
	}

	private renderEm(token: marked.Tokens.Em, key: string): React.ReactElement {
		const children = this.renderInlineTokens(token.tokens);
		return <em key={key}>{children}</em>;
	}

	private renderDel(token: marked.Tokens.Del, key: string): React.ReactElement {
		const children = this.renderInlineTokens(token.tokens);
		return <del key={key}>{children}</del>;
	}

	private renderLink(token: marked.Tokens.Link, key: string): React.ReactElement {
		const children = this.renderInlineTokens(token.tokens);
		// Use NotebookLink component for proper link handling
		return (
			<NotebookLink key={key} href={token.href} title={token.title || undefined}>
				{children}
			</NotebookLink>
		);
	}

	private renderImage(token: marked.Tokens.Image, key: string): React.ReactElement {
		// Use DeferredImage component for local image conversion and remote SVG handling
		return (
			<DeferredImage
				key={key}
				alt={token.text}
				src={token.href}
				title={token.title || undefined}
			/>
		);
	}

	private renderKatex(token: MarkedKatexExtension.KatexToken, key: string): React.ReactElement {
		// Provide the raw LaTeX and display mode to the KatexMath component
		// which will convert it to HTML using KaTeX and render it safely
		return (
			<KatexMath
				key={key}
				displayMode={token.displayMode}
				latex={token.text}
			/>
		);
	}

	/**
	 * Returns the collision-safe DOM ID for a footnote. The id must have been
	 * registered by collectFootnoteContext, which walks every ref and
	 * definition before rendering.
	 */
	private sanitizeFootnoteId(id: string): string {
		const safeId = this._footnoteSafeIdMap.get(id);
		if (safeId === undefined) {
			throw new Error(`Footnote id "${id}" was not registered; collectFootnoteContext() must run before rendering footnotes.`);
		}
		return safeId;
	}

	private renderFootnoteRef(token: MarkedFootnoteExtension.FootnoteRefToken, key: string): React.ReactElement {
		const num = this._footnoteNumberMap.get(token.id) ?? token.id;
		const safeId = this.sanitizeFootnoteId(token.id);
		// Generate unique anchor IDs when the same footnote is referenced multiple times.
		const refCount = (this._footnoteRefCounter.get(token.id) ?? 0) + 1;
		this._footnoteRefCounter.set(token.id, refCount);
		const refId = refCount === 1 ? `fnref-${safeId}` : `fnref-${safeId}-${refCount}`;
		return (
			<sup key={key} className='footnote-ref'>
				<NotebookLink href={`#fn-${safeId}`} id={refId}>{num}</NotebookLink>
			</sup>
		);
	}

	private renderFootnoteSection(definitions: MarkedFootnoteExtension.FootnoteDefinitionToken[]): React.ReactElement {
		return (
			<section key='footnotes' className='footnotes'>
				<hr />
				<ol>
					{definitions.map((def) => {
						const safeId = this.sanitizeFootnoteId(def.id);
						const wasReferenced = this._footnoteRefCounter.has(def.id);
						// Backref always targets the first ref anchor
						// (#fnref-<id>); secondary refs (#fnref-<id>-2, ...) get
						// no dedicated backref by design.
						const backref = wasReferenced
							? <NotebookLink className='footnote-backref' href={`#fnref-${safeId}`}>{'\u21a9'}</NotebookLink>
							: null;

						const bodyElements = def.tokens.map((token, i) => {
							const key = `fn-body-${safeId}-${i}`;
							const isLastToken = i === def.tokens.length - 1;
							// Place the backref inside the last paragraph for
							// correct inline layout, matching standard footnote rendering.
							if (isLastToken && backref && token.type === 'paragraph') {
								const para = token as marked.Tokens.Paragraph;
								return <p key={key}>{this.renderInlineTokens(para.tokens)}{' '}{backref}</p>;
							}
							return this.renderToken(token as ExtendedToken, key);
						});

						// Append backref as sibling when the last token is not a paragraph.
						const lastToken = def.tokens[def.tokens.length - 1];
						const backrefAppended = lastToken?.type === 'paragraph';

						return (
							<li key={`fn-${safeId}`} id={`fn-${safeId}`}>
								{bodyElements}
								{backref && !backrefAppended && <>{' '}{backref}</>}
							</li>
						);
					})}
				</ol>
			</section>
		);
	}

	/**
	 * Renders inline tokens (used for paragraph content, link text, etc.)
	 */
	private renderInlineTokens(tokens: marked.Token[]): React.ReactNode[] {
		return tokens.map((token, i) => {
			const key = `inline-${this.keyCounter++}`;
			return this.renderToken(token as ExtendedToken, key);
		});
	}

	/**
	 * Extracts plain text from tokens (used for generating heading IDs)
	 */
	private extractTextFromTokens(tokens: ExtendedToken[]): string {
		const parts: string[] = [];
		for (const token of tokens) {
			if (token.type === 'text') {
				parts.push((token as marked.Tokens.Text).text);
			} else if (token.type === 'code' || token.type === 'codespan') {
				parts.push((token as marked.Tokens.Code | marked.Tokens.Codespan).text);
			} else if (token.type === 'superscript' || token.type === 'subscript') {
				const supSubToken = token as MarkedSuperSubExtension.SuperSubToken;
				if (supSubToken.tokens && supSubToken.tokens.length > 0) {
					parts.push(this.extractTextFromTokens(supSubToken.tokens));
				} else {
					parts.push(supSubToken.text);
				}
			} else if ('tokens' in token && Array.isArray(token.tokens)) {
				parts.push(this.extractTextFromTokens(token.tokens));
			}
		}
		return parts.join('');
	}
}

/**
 * Renders markdown content to React elements using token-based rendering.
 * Pipeline: Markdown → Tokens → React (with HTML parsing only for math/code blocks)
 *
 * The markdown string is converted to tokens using Marked, then tokens are rendered
 * directly to React elements. There are some exceptions where HTML parsing is still
 * required.
 *
 * LaTeX math expressions use KaTeX which returns HTML instead of tokens that can be
 * passed to the React renderer. Therefore we still need to use `safeSetInnerHtml`
 * which requires HTML parsing. Similarly, syntax-highlighted code blocks return HTML.
 *
 * @param content: Markdown content to render in string form
 * @param extensionService: Extension service for loading language extensions
 * @param languageService: Language service for syntax highlighting
 * @returns Array of React elements containing the rendered markdown.
 */
export async function renderNotebookMarkdown(
	content: string,
	extensionService: IExtensionService,
	languageService: ILanguageService
): Promise<React.ReactElement[]> {
	// Load KaTeX extension
	const katexExtension = await MarkedKatexSupport.loadExtension(
		getWindow(document),
		{ throwOnError: false }
	);

	// Create Marked instance with KaTeX, superscript/subscript, and footnote extensions
	const markedInstance = new marked.Marked()
		.use(katexExtension)
		.use(MarkedSuperSubExtension.extension())
		.use(MarkedFootnoteExtension.extension());

	// Tokenize markdown (KaTeX extension creates custom tokens)
	const tokens = markedInstance.lexer(content) as ExtendedToken[];

	// Render tokens to React elements
	const renderer = new TokenMarkdownRenderer(extensionService, languageService);
	return renderer.render(tokens);
}
