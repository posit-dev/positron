/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { importAMDNodeModule } from '../../../../amdX.js';
import { safeSetInnerHtml } from '../../../../base/browser/domSanitize.js';
import { allowedMarkdownHtmlTags, allowedMarkdownHtmlAttributes } from '../../../../base/browser/markdownRenderer.js';
import { getWindow } from '../../../../base/browser/dom.js';
import { MarkedKatexSupport } from '../../markdown/browser/markedKatexSupport.js';
import { POSITRON_QUARTO_EQUATION_PREVIEW_KEY } from '../common/positronQuartoConfig.js';
import { IInlinePreviewItem, QuartoInlinePreviewContribution, QuartoInlinePreviewViewZone } from './quartoInlinePreview.js';

type KatexModule = typeof import('katex').default;

let cachedKatex: KatexModule | undefined;
let katexPromise: Promise<KatexModule> | undefined;

/**
 * Load KaTeX once and cache it so that subsequent renders are synchronous.
 * Mirrors the loader in the notebook `KatexMath` component.
 */
function getKatex(): Promise<KatexModule> {
	if (!katexPromise) {
		katexPromise = importAMDNodeModule<KatexModule>('katex', 'dist/katex.min.js')
			.then(k => { cachedKatex = k; return k; });
	}
	return katexPromise;
}

/**
 * Minimum height for an equation preview view zone in pixels.
 */
const MIN_VIEW_ZONE_HEIGHT = 32;

/**
 * Vertical breathing room (px) above and below the rendered equation. Must match
 * the top/bottom `padding` on `.quarto-equation-preview-wrapper` in
 * `media/quartoEquationPreview.css`.
 */
const VERTICAL_PADDING = 16;

/**
 * A display-math block discovered in a document.
 */
export interface DisplayMathBlock {
	/** Line number (1-based) containing the closing `$$`. */
	readonly closingLineNumber: number;
	/** The LaTeX source between the delimiters, trimmed. */
	readonly latex: string;
}

/**
 * Find all display-math blocks (`$$ ... $$`) in a document.
 *
 * Handles both single-line (`$$ E = mc^2 $$`) and multi-line blocks, strips a
 * trailing Quarto equation label (`{#eq-...}`) by virtue of only capturing
 * content between the `$$` delimiters, skips `$$` inside fenced code regions and
 * YAML front matter, and ignores inline `$...$` math. The view zone for a block
 * is placed after the line containing its closing `$$`.
 *
 * Exported so the detection logic - the heart of the feature - can be tested
 * without a live editor.
 */
export function findDisplayMathBlocks(lines: string[]): DisplayMathBlock[] {
	const blocks: DisplayMathBlock[] = [];

	let inMath = false;
	let contentParts: string[] = [];
	let inYaml = false;
	let fenceMarker: string | undefined;
	let fenceLength = 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		if (!inMath) {
			const trimmed = line.trim();

			// YAML front matter only at the very top of the document.
			if (i === 0 && trimmed === '---') {
				inYaml = true;
				continue;
			}
			if (inYaml) {
				if (trimmed === '---' || trimmed === '...') {
					inYaml = false;
				}
				continue;
			}

			// Fenced code regions: ignore `$$` inside them.
			if (fenceMarker === undefined) {
				const open = trimmed.match(/^(`{3,}|~{3,})/);
				if (open) {
					fenceMarker = open[1][0];
					fenceLength = open[1].length;
					continue;
				}
			} else {
				const close = trimmed.match(/^(`{3,}|~{3,})\s*$/);
				if (close && close[1][0] === fenceMarker && close[1].length >= fenceLength) {
					fenceMarker = undefined;
					fenceLength = 0;
				}
				continue;
			}
		}

		// Scan the line for `$$` delimiters, toggling in/out of math. A single
		// line may contain both the opening and closing delimiter.
		let pos = 0;
		while (true) {
			const idx = line.indexOf('$$', pos);
			if (idx < 0) {
				if (inMath) {
					contentParts.push(line.slice(pos));
				}
				break;
			}

			if (!inMath) {
				inMath = true;
				contentParts = [];
				pos = idx + 2;
			} else {
				contentParts.push(line.slice(pos, idx));
				const latex = contentParts.join('\n').trim();
				if (latex.length > 0) {
					blocks.push({ closingLineNumber: i + 1, latex });
				}
				inMath = false;
				contentParts = [];
				pos = idx + 2;
			}
		}
	}

	return blocks;
}

/**
 * Render a display-math LaTeX string into a container using KaTeX, sanitized and
 * themed via the shared markdown KaTeX support. Mirrors the notebook `KatexMath`
 * component but renders into plain DOM (the view zone is not a React tree).
 *
 * On a KaTeX failure the container falls back to the raw LaTeX text (no element
 * children), which the rendering test relies on to distinguish "rendered" from
 * "detected but not rendered".
 *
 * Exported for high-level testing of the render step.
 */
export function renderDisplayMath(container: HTMLElement, katex: KatexModule, latex: string): void {
	try {
		const html = katex.renderToString(latex, {
			throwOnError: false,
			displayMode: true,
		});
		const sanitizerConfig = MarkedKatexSupport.getSanitizerOptions({
			allowedTags: allowedMarkdownHtmlTags,
			allowedAttributes: allowedMarkdownHtmlAttributes,
		});
		safeSetInnerHtml(container, html, sanitizerConfig);
	} catch {
		container.textContent = latex;
	}
}

/**
 * View zone that renders a display-math equation inline below its `$$` block.
 */
class QuartoEquationPreviewViewZone extends QuartoInlinePreviewViewZone {
	private _disposed = false;

	constructor(
		editor: ICodeEditor,
		lineNumber: number,
		latex: string,
	) {
		super(
			editor,
			lineNumber,
			latex,
			'quarto-equation-preview-wrapper',
			'quarto-equation-preview-container',
			MIN_VIEW_ZONE_HEIGHT,
		);

		this._render();
	}

	private _render(): void {
		// Ensure styles on the editor's window (the container is not attached to
		// the DOM yet at construction time, so derive the window from the editor).
		MarkedKatexSupport.ensureKatexStyles(getWindow(this.editor.getDomNode() ?? this.container));

		const latex = this.contentKey;
		if (cachedKatex) {
			renderDisplayMath(this.container, cachedKatex, latex);
			this.updateHeight();
			return;
		}

		getKatex().then(katex => {
			// Guard against disposal and against a later edit that already changed
			// the content while KaTeX was loading.
			if (this._disposed || this.contentKey !== latex) {
				return;
			}
			renderDisplayMath(this.container, katex, latex);
			this.updateHeight();
		}).catch(() => {
			if (!this._disposed && this.contentKey === latex) {
				this.container.textContent = latex;
				this.updateHeight();
			}
		});
	}

	override update(item: IInlinePreviewItem): boolean {
		if (item.contentKey === this.contentKey) {
			this.updateAfterLineNumber(item.lineNumber);
			return true;
		}
		// Re-render the new equation in place (no flicker, no zone churn).
		this.contentKey = item.contentKey;
		this.updateAfterLineNumber(item.lineNumber);
		this._render();
		return true;
	}

	protected override measureHeight(): number {
		// Use the container's laid-out box height (`offsetHeight`) as the visible
		// equation height. `scrollHeight` can be larger because KaTeX paints a few
		// pixels of invisible strut past the box; including that would unbalance
		// the spacing. The breathing room is provided by the wrapper's padding, and
		// the view zone height (which the editor applies to the wrapper) must equal
		// the equation height plus that padding so the wrapper's content area
		// exactly fits the equation.
		const contentHeight = this.container.offsetHeight;
		return Math.max(MIN_VIEW_ZONE_HEIGHT, contentHeight + VERTICAL_PADDING * 2);
	}

	override dispose(): void {
		this._disposed = true;
		super.dispose();
	}
}

/**
 * Editor contribution that renders Quarto display-math equations as inline
 * previews below each `$$ ... $$` block. Gated on the
 * `positron.quarto.equationPreview.enabled` setting; unlike inline output this is
 * a pure editor feature and does not require the Quarto extension or a kernel.
 */
export class QuartoEquationPreviewContribution extends QuartoInlinePreviewContribution<IInlinePreviewItem> {
	static readonly ID = 'editor.contrib.quartoEquationPreview';

	constructor(
		editor: ICodeEditor,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
	) {
		super(editor);

		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(POSITRON_QUARTO_EQUATION_PREVIEW_KEY)) {
				this.onEnablementChanged();
			}
		}));

		this.start();
	}

	protected override isEnabled(): boolean {
		return this._configurationService.getValue<boolean>(POSITRON_QUARTO_EQUATION_PREVIEW_KEY) ?? false;
	}

	protected override findItems(model: ITextModel): IInlinePreviewItem[] {
		const lines: string[] = [];
		const lineCount = model.getLineCount();
		for (let lineNumber = 1; lineNumber <= lineCount; lineNumber++) {
			lines.push(model.getLineContent(lineNumber));
		}

		return findDisplayMathBlocks(lines).map(block => ({
			lineNumber: block.closingLineNumber,
			contentKey: block.latex,
		}));
	}

	protected override async createViewZone(item: IInlinePreviewItem): Promise<QuartoInlinePreviewViewZone | undefined> {
		return new QuartoEquationPreviewViewZone(this.editor, item.lineNumber, item.contentKey);
	}
}
