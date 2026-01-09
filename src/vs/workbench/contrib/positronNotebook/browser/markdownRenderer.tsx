/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
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

/**
 * Decodes HTML entities in a string
 * Converts &quot; → ", &amp; → &, &lt; → <, &gt; → >, etc.
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
type ExtendedToken = marked.Token | MarkedKatexExtension.KatexToken;

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

		// TODO: why did I need to load katex this way? double check this!!
		// Load KaTeX using the same approach as MarkedKatexSupport.ts
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
 * TODO: do we need this? should we turn html into tokens and then
 * render via the TokenMarkdownRenderer? if we don't need to support
 * this we can remove domToReact.tsx file as well.
 *
 * Component that renders raw html safely with component overrides.
 *
 * Sinde we aren't able to convert raw HTML to React elements directly,
 * we need to parse the HTML into DOM nodes first.
 *
 * This uses safeSetInnerHtml to parse the HTML string into the DOM,
 * and then converts the DOM nodes to React elements.
 *
 * @param code The raw code string to highlight
 * @param lang The language identifier (e.g., 'javascript', 'python')
 * @param extensionService Extension service for loading language extensions
 * @param languageService Language service for syntax highlighting
 * @returns React element containing the syntax-highlighted code block
 */
function RawHtml({ html }: { html: string }) {
	const reactElements = React.useMemo(() => {
		// Filter out the restrictive style rule from default markdown attributes
		const baseAttributes = allowedMarkdownHtmlAttributes.filter(attr =>
			typeof attr === 'string' || attr.attributeName !== 'style'
		);

		// Configure to allow remote images and local links (same as Markdown.tsx)
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

	return <div className='raw-html-content'>{reactElements}</div>;
}

/**
 * Renderer that converts Marked tokens to React elements.
 * Uses component overrides to handle special cases (complex HTML):
 * - Links: NotebookLink
 * - Images: DeferredImage
 * - Raw HTML: RawHtml
 * - LaTeX math: KatexMath
 * - Syntax-highlighted code blocks: SyntaxHighlightedCode
 */
export class TokenMarkdownRenderer {
	private keyCounter = 0;
	private slugCounter = new Map<string, number>();

	constructor(
		private extensionService: IExtensionService,
		private languageService: ILanguageService
	) { }

	/**
	 * Renders an array of tokens to React elements
	 */
	render(tokens: ExtendedToken[]): React.ReactElement[] {
		return tokens.map((token, i) => this.renderToken(token, `token-${i}`));
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
			// TODO: review how to handle html
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
			// Custom KaTeX tokens
			case 'inlineKatex':
			case 'blockKatex':
				return this.renderKatex(token as MarkedKatexExtension.KatexToken, key);
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
		// Raw HTML in markdown - render using RawHtml component which uses safeSetInnerHtml
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
	private extractTextFromTokens(tokens: marked.Token[]): string {
		const parts: string[] = [];
		for (const token of tokens) {
			if (token.type === 'text') {
				parts.push(token.text);
			} else if (token.type === 'code' || token.type === 'codespan') {
				parts.push((token as marked.Tokens.Code | marked.Tokens.Codespan).text);
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

	// Create Marked instance with KaTeX extension which handles LaTeX
	const markedInstance = new marked.Marked().use(katexExtension);

	// Tokenize markdown (KaTeX extension creates custom tokens)
	const tokens = markedInstance.lexer(content) as ExtendedToken[];

	// Render tokens to React elements
	const renderer = new TokenMarkdownRenderer(extensionService, languageService);
	return renderer.render(tokens);
}
