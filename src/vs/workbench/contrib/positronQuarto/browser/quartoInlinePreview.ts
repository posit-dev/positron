/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ICodeEditor, IViewZone } from '../../../../editor/browser/editorBrowser.js';
import { IEditorContribution } from '../../../../editor/common/editorCommon.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { EditorLayoutInfo } from '../../../../editor/common/config/editorOptions.js';
import { URI } from '../../../../base/common/uri.js';
import { isQuartoDocument } from '../common/positronQuartoConfig.js';

/**
 * Delay (ms) before re-parsing the document after a content change.
 */
const REPARSE_DEBOUNCE_MS = 200;

/**
 * An item discovered in the document that should be rendered as an inline
 * preview view zone. Items are keyed by their line number; the {@link contentKey}
 * is compared on re-parse so that an existing view zone is only re-rendered when
 * its underlying content actually changes (e.g. the user edits the equation or
 * image path on that line).
 */
export interface IInlinePreviewItem {
	/** Line number (1-based) the view zone is displayed after. */
	readonly lineNumber: number;
	/** Stable representation of the rendered content; change triggers a re-render. */
	readonly contentKey: string;
}

/**
 * Base class for view zones that render an inline preview (image, equation, ...)
 * below a line in the editor. Owns the view zone lifecycle (show/hide/dispose),
 * width tracking against the editor layout, and a resize observer that keeps the
 * view zone height in sync with its rendered content.
 *
 * Subclasses build their content into {@link container} and implement
 * {@link measureHeight}.
 */
export abstract class QuartoInlinePreviewViewZone extends Disposable implements IViewZone {
	// IViewZone properties.
	public afterLineNumber: number;
	public heightInPx: number;
	public readonly domNode: HTMLElement;
	public readonly suppressMouseDown = false;

	private _zoneId: string | undefined;
	private _resizeObserver: ResizeObserver | undefined;

	/** Container the subclass renders its content into. */
	protected readonly container: HTMLElement;

	constructor(
		protected readonly editor: ICodeEditor,
		lineNumber: number,
		public contentKey: string,
		wrapperClassName: string,
		containerClassName: string,
		initialHeightInPx: number,
	) {
		super();

		this.afterLineNumber = lineNumber;
		this.heightInPx = initialHeightInPx;

		this.domNode = document.createElement('div');
		this.domNode.className = wrapperClassName;

		this.container = document.createElement('div');
		this.container.className = containerClassName;
		this.domNode.appendChild(this.container);

		// Keep the content width in sync with the editor layout.
		this._register(this.editor.onDidLayoutChange(() => {
			if (this._zoneId) {
				this._applyWidth();
			}
		}));
	}

	/**
	 * Measure the desired height (px) of the rendered content. Called after the
	 * content renders and on every resize.
	 */
	protected abstract measureHeight(): number;

	/**
	 * Reconcile this view zone against a (possibly changed) item at the same line.
	 *
	 * Returns `true` if the view zone now reflects the item (either the content
	 * was unchanged, or the subclass re-rendered it in place). Returns `false` if
	 * the content changed and this view zone cannot update in place - the
	 * contribution then disposes it and creates a fresh one (used by previews
	 * whose content must be resolved asynchronously, e.g. images).
	 *
	 * The base implementation only handles the unchanged case; subclasses that can
	 * re-render synchronously (e.g. equations) override this.
	 */
	update(item: IInlinePreviewItem): boolean {
		if (item.contentKey === this.contentKey) {
			this.updateAfterLineNumber(item.lineNumber);
			return true;
		}
		return false;
	}

	/**
	 * Calculate the content width from the editor layout.
	 */
	private _getWidth(layoutInfo: EditorLayoutInfo): number {
		return layoutInfo.contentWidth - layoutInfo.verticalScrollbarWidth - 4;
	}

	private _applyWidth(): void {
		const width = this._getWidth(this.editor.getLayoutInfo());
		this.container.style.maxWidth = `${width}px`;
	}

	/**
	 * Update the line number this zone appears after.
	 */
	updateAfterLineNumber(lineNumber: number): void {
		if (this.afterLineNumber === lineNumber) {
			return;
		}
		this.afterLineNumber = lineNumber;
		if (this._zoneId) {
			this.editor.changeViewZones(accessor => {
				accessor.removeZone(this._zoneId!);
				this._zoneId = accessor.addZone(this);
			});
			this._applyWidth();
		}
	}

	/**
	 * Show the view zone in the editor.
	 */
	show(): void {
		if (this._zoneId) {
			return;
		}

		this.editor.changeViewZones(accessor => {
			this._zoneId = accessor.addZone(this);
		});

		this._applyWidth();
		this._setupResizeObserver();
	}

	/**
	 * Hide the view zone from the editor.
	 */
	hide(): void {
		if (!this._zoneId) {
			return;
		}

		this.editor.changeViewZones(accessor => {
			accessor.removeZone(this._zoneId!);
		});
		this._zoneId = undefined;

		this._disposeResizeObserver();
	}

	/**
	 * Check if the view zone is currently visible.
	 */
	isVisible(): boolean {
		return this._zoneId !== undefined;
	}

	private _setupResizeObserver(): void {
		if (this._resizeObserver) {
			return;
		}

		this._resizeObserver = new ResizeObserver(() => {
			this.updateHeight();
		});
		this._resizeObserver.observe(this.container);
	}

	private _disposeResizeObserver(): void {
		if (this._resizeObserver) {
			this._resizeObserver.disconnect();
			this._resizeObserver = undefined;
		}
	}

	/**
	 * Recompute the view zone height from the rendered content and re-lay-out the
	 * zone if it changed.
	 */
	protected updateHeight(): void {
		const newHeight = this.measureHeight();
		if (newHeight === this.heightInPx) {
			return;
		}

		this.heightInPx = newHeight;
		if (this._zoneId) {
			this.editor.changeViewZones(accessor => {
				accessor.removeZone(this._zoneId!);
				this._zoneId = accessor.addZone(this);
			});
			this._applyWidth();
		}
	}

	override dispose(): void {
		this.hide();
		this._disposeResizeObserver();
		super.dispose();
	}
}

/**
 * Base editor contribution that manages inline preview view zones for Quarto
 * documents. Owns parsing/debouncing, the line-keyed view zone map, and the diff
 * that creates, updates, and disposes view zones as the document changes.
 *
 * Subclasses provide the feature gate ({@link isEnabled}), parse the document
 * ({@link findItems}), and build view zones ({@link createViewZone}). Each
 * subclass also wires up its own enablement listener and calls
 * {@link onEnablementChanged} when the gate flips.
 */
export abstract class QuartoInlinePreviewContribution<TItem extends IInlinePreviewItem>
	extends Disposable implements IEditorContribution {

	protected readonly viewZones = new Map<number, QuartoInlinePreviewViewZone>();
	protected documentUri: URI | undefined;

	private _enabled = false;
	private _parseTimeout: ReturnType<typeof setTimeout> | undefined;
	private readonly _contentDisposables = this._register(new DisposableStore());

	constructor(
		protected readonly editor: ICodeEditor,
	) {
		super();

		this.documentUri = this.editor.getModel()?.uri;

		this._register(this.editor.onDidChangeModel(() => {
			this._teardown();
			this.documentUri = this.editor.getModel()?.uri;
			if (this._enabled && this.isQuartoDocument()) {
				this._initialize();
			}
		}));
	}

	/**
	 * Whether the feature is currently enabled (setting/context key state only;
	 * the base separately checks that the document is a Quarto document).
	 */
	protected abstract isEnabled(): boolean;

	/**
	 * Find the items in the document that should be previewed.
	 */
	protected abstract findItems(model: ITextModel): TItem[];

	/**
	 * Build (and show) a view zone for an item. Returns undefined if no preview
	 * should be shown (e.g. a remote image is skipped). Implementations should not
	 * call `show()` - the base does that.
	 */
	protected abstract createViewZone(item: TItem): Promise<QuartoInlinePreviewViewZone | undefined>;

	/**
	 * Must be called by subclasses after construction to perform the initial
	 * parse if the feature is enabled.
	 */
	protected start(): void {
		this._enabled = this.isEnabled();
		if (this._enabled && this.isQuartoDocument()) {
			this._initialize();
		}
	}

	/**
	 * Re-evaluate the feature gate; called by subclasses from their enablement
	 * listeners.
	 */
	protected onEnablementChanged(): void {
		const enabled = this.isEnabled();
		if (enabled === this._enabled) {
			return;
		}
		this._enabled = enabled;

		if (!enabled) {
			this._teardown();
		} else if (this.isQuartoDocument()) {
			this._initialize();
		}
	}

	protected isQuartoDocument(): boolean {
		const model = this.editor.getModel();
		return isQuartoDocument(this.documentUri?.path, model?.getLanguageId());
	}

	private _initialize(): void {
		this._parseDocument();
		this._contentDisposables.add(this.editor.onDidChangeModelContent(() => {
			if (this._parseTimeout) {
				clearTimeout(this._parseTimeout);
			}
			this._parseTimeout = setTimeout(() => {
				this._parseTimeout = undefined;
				this._parseDocument();
			}, REPARSE_DEBOUNCE_MS);
		}));
	}

	private _teardown(): void {
		this._contentDisposables.clear();
		if (this._parseTimeout) {
			clearTimeout(this._parseTimeout);
			this._parseTimeout = undefined;
		}
		this._disposeAllViewZones();
	}

	private _parseDocument(): void {
		const model = this.editor.getModel();
		if (!model || !this.documentUri) {
			return;
		}
		void this._updateViewZones(this.findItems(model));
	}

	private async _updateViewZones(items: TItem[]): Promise<void> {
		const itemsByLine = new Map<number, TItem>();
		for (const item of items) {
			itemsByLine.set(item.lineNumber, item);
		}

		// Remove view zones for lines that no longer have an item.
		for (const [lineNumber, viewZone] of this.viewZones) {
			if (!itemsByLine.has(lineNumber)) {
				viewZone.dispose();
				this.viewZones.delete(lineNumber);
			}
		}

		// Create or update view zones for items.
		const createPromises: Promise<void>[] = [];
		for (const item of items) {
			const existing = this.viewZones.get(item.lineNumber);
			if (existing) {
				// If the zone can't reflect the new content in place, replace it.
				if (!existing.update(item)) {
					existing.dispose();
					this.viewZones.delete(item.lineNumber);
					createPromises.push(this._createAndShow(item));
				}
			} else {
				createPromises.push(this._createAndShow(item));
			}
		}

		await Promise.all(createPromises);
	}

	private async _createAndShow(item: TItem): Promise<void> {
		const viewZone = await this.createViewZone(item);
		if (!viewZone) {
			return;
		}
		// The document may have changed while we were resolving the view zone; if
		// another zone now occupies this line, drop the one we just built.
		if (this.viewZones.has(item.lineNumber)) {
			viewZone.dispose();
			return;
		}
		this.viewZones.set(item.lineNumber, viewZone);
		viewZone.show();
	}

	private _disposeAllViewZones(): void {
		for (const viewZone of this.viewZones.values()) {
			viewZone.dispose();
		}
		this.viewZones.clear();
	}

	override dispose(): void {
		if (this._parseTimeout) {
			clearTimeout(this._parseTimeout);
		}
		this._disposeAllViewZones();
		super.dispose();
	}
}
