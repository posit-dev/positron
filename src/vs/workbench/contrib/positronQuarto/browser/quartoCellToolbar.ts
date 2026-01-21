/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IOverlayWidget, IOverlayWidgetPosition, ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { QuartoCodeCell } from '../common/quartoTypes.js';
import { CellExecutionState } from '../common/quartoExecutionTypes.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { getDefaultHoverDelegate } from '../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { QuartoCommandId } from './quartoCommands.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { getWindow } from '../../../../base/browser/dom.js';

/**
 * A toolbar widget that appears in the upper-right corner of Quarto code cells.
 * Provides buttons for Run Cell, Run Above, and Run Below actions.
 * Uses an overlay widget for viewport-relative positioning.
 */
export class QuartoCellToolbar extends Disposable implements IOverlayWidget {
	readonly allowEditorOverflow = false;

	private readonly _domNode: HTMLElement;
	private _runButton!: HTMLButtonElement;
	private _runAboveButton!: HTMLButtonElement;
	private _runBelowButton!: HTMLButtonElement;
	private _buttons!: HTMLButtonElement[];
	private readonly _hoverDisposables = this._register(new DisposableStore());
	private _isRunning = false;
	private _visible = true;
	private _isMouseOverToolbar = false;
	private _isCursorInCell = false;

	constructor(
		private readonly _editor: ICodeEditor,
		private readonly _cell: QuartoCodeCell,
		private _cellIndex: number,
		private _totalCells: number,
		private readonly _onRun: () => void,
		private readonly _onStop: () => void,
		private readonly _onRunAbove: () => void,
		private readonly _onRunBelow: () => void,
		private readonly _hoverService: IHoverService,
		private readonly _keybindingService: IKeybindingService
	) {
		super();
		this._domNode = this._createDomNode();

		this._updateButtonVisibility();
		this._setupKeyboardNavigation();
		this._setupRichTooltips();
		this._setupMouseTracking();
		this._editor.addOverlayWidget(this);

		// Listen for scroll and layout changes to update position
		this._register(this._editor.onDidScrollChange(() => {
			this._updatePosition();
		}));

		this._register(this._editor.onDidLayoutChange(() => {
			this._updatePosition();
		}));

		// Initial position update
		this._updatePosition();
	}

	getId(): string {
		return `quarto-cell-toolbar-${this._cell.id}`;
	}

	getDomNode(): HTMLElement {
		return this._domNode;
	}

	getPosition(): IOverlayWidgetPosition | null {
		// Return null - we position ourselves via _updatePosition()
		return null;
	}

	/**
	 * Update the position of the toolbar based on the line position and editor layout.
	 */
	private _updatePosition(): void {
		if (!this._visible) {
			this._domNode.style.display = 'none';
			return;
		}

		const lineNumber = this._cell.startLine;
		const lineTop = this._editor.getTopForLineNumber(lineNumber);
		const scrollTop = this._editor.getScrollTop();
		const layoutInfo = this._editor.getLayoutInfo();

		// Calculate vertical position: line top relative to viewport, offset to appear half above
		const lineHeight = this._editor.getOption(/* lineHeight */ 66);
		const toolbarHeight = this._domNode.offsetHeight || 26;
		const verticalOffset = (toolbarHeight - lineHeight) / 2;
		const top = lineTop - scrollTop - verticalOffset;

		// Calculate horizontal position: right edge of content area
		const rightOffset = 14;
		const left = layoutInfo.width - layoutInfo.minimap.minimapWidth - layoutInfo.verticalScrollbarWidth - (this._domNode.offsetWidth || 80) - rightOffset;

		// Check if the toolbar is within the visible viewport
		const isInViewport = top >= -toolbarHeight && top <= layoutInfo.height;

		if (isInViewport) {
			this._domNode.style.display = '';
			this._domNode.style.top = `${top}px`;
			this._domNode.style.left = `${left}px`;
		} else {
			this._domNode.style.display = 'none';
		}
	}

	/**
	 * Update the cell index and total cells count.
	 * This is used when cells are added or removed to update button visibility.
	 */
	updateCellPosition(cellIndex: number, totalCells: number): void {
		if (this._cellIndex !== cellIndex || this._totalCells !== totalCells) {
			this._cellIndex = cellIndex;
			this._totalCells = totalCells;
			this._updateButtonVisibility();
		}
	}

	/**
	 * Set the execution state of the cell, which affects the Run/Stop button.
	 */
	setExecutionState(state: CellExecutionState): void {
		const wasRunning = this._isRunning;
		this._isRunning = state === CellExecutionState.Running || state === CellExecutionState.Queued;

		if (wasRunning !== this._isRunning) {
			this._updateRunButton();
		}
	}

	/**
	 * Hide the toolbar.
	 */
	hide(): void {
		this._visible = false;
		this._updatePosition();
	}

	/**
	 * Show the toolbar.
	 */
	show(): void {
		this._visible = true;
		this._updatePosition();
	}

	/**
	 * Get the cell this toolbar belongs to.
	 */
	get cell(): QuartoCodeCell {
		return this._cell;
	}

	/**
	 * Check if the mouse is currently over the toolbar.
	 */
	get isMouseOverToolbar(): boolean {
		return this._isMouseOverToolbar;
	}

	/**
	 * Set whether the cursor is currently inside this cell.
	 * This controls the visual visibility of the toolbar.
	 */
	setCursorInCell(inCell: boolean): void {
		this._isCursorInCell = inCell;
		this._updateVisualVisibility();
	}

	/**
	 * Update the visual visibility of the toolbar based on cursor and mouse state.
	 */
	private _updateVisualVisibility(): void {
		const shouldBeVisible = this._isCursorInCell || this._isMouseOverToolbar;
		if (shouldBeVisible) {
			this._domNode.classList.add('visible');
		} else {
			this._domNode.classList.remove('visible');
		}
	}

	/**
	 * Set up mouse tracking for the toolbar to keep it visible when hovered.
	 */
	private _setupMouseTracking(): void {
		this._domNode.addEventListener('mouseenter', () => {
			this._isMouseOverToolbar = true;
			this._updateVisualVisibility();
		});

		this._domNode.addEventListener('mouseleave', () => {
			this._isMouseOverToolbar = false;
			this._updateVisualVisibility();
		});
	}

	private _createDomNode(): HTMLElement {
		const container = document.createElement('div');
		container.className = 'quarto-cell-toolbar';

		// Run Above button (only shown if not first cell)
		this._runAboveButton = document.createElement('button');
		this._runAboveButton.className = 'quarto-toolbar-btn quarto-toolbar-run-above';
		this._runAboveButton.setAttribute('aria-label', localize('quarto.toolbar.runAbove.aria', 'Run all cells above this cell'));
		this._runAboveButton.setAttribute('tabindex', '0');
		const runAboveIcon = document.createElement('span');
		runAboveIcon.classList.add(...ThemeIcon.asClassNameArray(Codicon.runAbove));
		this._runAboveButton.appendChild(runAboveIcon);
		this._runAboveButton.addEventListener('click', (e) => {
			e.stopPropagation();
			this._onRunAbove();
		});
		container.appendChild(this._runAboveButton);

		// Run/Stop button
		this._runButton = document.createElement('button');
		this._runButton.className = 'quarto-toolbar-btn quarto-toolbar-run';
		this._runButton.setAttribute('aria-label', localize('quarto.toolbar.runCell.aria', 'Run this cell'));
		this._runButton.setAttribute('tabindex', '0');
		const runIcon = document.createElement('span');
		runIcon.classList.add(...ThemeIcon.asClassNameArray(Codicon.play));
		this._runButton.appendChild(runIcon);
		this._runButton.addEventListener('click', (e) => {
			e.stopPropagation();
			if (this._isRunning) {
				this._onStop();
			} else {
				this._onRun();
			}
		});
		container.appendChild(this._runButton);

		// Run Below button (only shown if not last cell)
		this._runBelowButton = document.createElement('button');
		this._runBelowButton.className = 'quarto-toolbar-btn quarto-toolbar-run-below';
		this._runBelowButton.setAttribute('aria-label', localize('quarto.toolbar.runBelow.aria', 'Run this cell and all cells below'));
		this._runBelowButton.setAttribute('tabindex', '0');
		const runBelowIcon = document.createElement('span');
		runBelowIcon.classList.add(...ThemeIcon.asClassNameArray(Codicon.runBelow));
		this._runBelowButton.appendChild(runBelowIcon);
		this._runBelowButton.addEventListener('click', (e) => {
			e.stopPropagation();
			this._onRunBelow();
		});
		container.appendChild(this._runBelowButton);

		// Store button array for keyboard navigation
		this._buttons = [this._runAboveButton, this._runButton, this._runBelowButton];

		return container;
	}

	private _updateRunButton(): void {
		// Clear existing icon
		while (this._runButton.firstChild) {
			this._runButton.removeChild(this._runButton.firstChild);
		}

		const icon = document.createElement('span');
		if (this._isRunning) {
			icon.classList.add(...ThemeIcon.asClassNameArray(Codicon.debugStop));
			this._runButton.appendChild(icon);
			this._runButton.setAttribute('aria-label', localize('quarto.toolbar.stopExecution.aria', 'Stop cell execution'));
			this._runButton.classList.add('running');
		} else {
			icon.classList.add(...ThemeIcon.asClassNameArray(Codicon.play));
			this._runButton.appendChild(icon);
			this._runButton.setAttribute('aria-label', localize('quarto.toolbar.runCell.aria', 'Run this cell'));
			this._runButton.classList.remove('running');
		}
		// Update the rich tooltip to reflect new state
		this._updateRichTooltips();
	}

	private _updateButtonVisibility(): void {
		// Hide "Run Above" for first cell
		this._runAboveButton.style.display = this._cellIndex === 0 ? 'none' : '';

		// Hide "Run Below" for last cell
		this._runBelowButton.style.display = this._cellIndex === this._totalCells - 1 ? 'none' : '';
	}

	/**
	 * Set up keyboard navigation within the toolbar using arrow keys.
	 */
	private _setupKeyboardNavigation(): void {
		this._domNode.addEventListener('keydown', (e) => {
			const visibleButtons = this._buttons.filter(btn => btn.style.display !== 'none');
			const currentIndex = visibleButtons.indexOf(getWindow(this._domNode).document.activeElement as HTMLButtonElement);

			if (currentIndex === -1) {
				return;
			}

			let newIndex = currentIndex;
			if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
				e.preventDefault();
				newIndex = (currentIndex + 1) % visibleButtons.length;
			} else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
				e.preventDefault();
				newIndex = (currentIndex - 1 + visibleButtons.length) % visibleButtons.length;
			} else if (e.key === 'Home') {
				e.preventDefault();
				newIndex = 0;
			} else if (e.key === 'End') {
				e.preventDefault();
				newIndex = visibleButtons.length - 1;
			}

			if (newIndex !== currentIndex) {
				visibleButtons[newIndex].focus();
			}
		});

		// Set role="toolbar" for accessibility
		this._domNode.setAttribute('role', 'toolbar');
		this._domNode.setAttribute('aria-label', localize('quarto.toolbar.label', 'Quarto cell actions'));
	}

	/**
	 * Set up rich tooltips with keyboard shortcut hints.
	 */
	private _setupRichTooltips(): void {
		this._hoverDisposables.clear();

		const hoverDelegate = getDefaultHoverDelegate('element');

		// Run/Stop button tooltip
		const runTooltip = this._getRunButtonTooltip();
		this._hoverDisposables.add(
			this._hoverService.setupManagedHover(hoverDelegate, this._runButton, runTooltip)
		);

		// Run Above button tooltip
		const runAboveTooltip = localize('quarto.toolbar.runAbove.tooltip', 'Run Cells Above');
		this._hoverDisposables.add(
			this._hoverService.setupManagedHover(hoverDelegate, this._runAboveButton, runAboveTooltip)
		);

		// Run Below button tooltip
		const runBelowTooltip = localize('quarto.toolbar.runBelow.tooltip', 'Run Cell and Below');
		this._hoverDisposables.add(
			this._hoverService.setupManagedHover(hoverDelegate, this._runBelowButton, runBelowTooltip)
		);
	}

	/**
	 * Get the tooltip text for the run/stop button, including keyboard shortcut.
	 */
	private _getRunButtonTooltip(): string {
		if (this._isRunning) {
			const keybinding = this._keybindingService.lookupKeybinding(QuartoCommandId.CancelExecution);
			const keybindingLabel = keybinding?.getLabel();
			if (keybindingLabel) {
				return localize('quarto.toolbar.stopExecution.tooltip', 'Stop Execution ({0})', keybindingLabel);
			}
			return localize('quarto.toolbar.stopExecution', 'Stop Execution');
		} else {
			const keybinding = this._keybindingService.lookupKeybinding(QuartoCommandId.RunCurrentCell);
			const keybindingLabel = keybinding?.getLabel();
			if (keybindingLabel) {
				return localize('quarto.toolbar.runCell.tooltip', 'Run Cell ({0})', keybindingLabel);
			}
			return localize('quarto.toolbar.runCell', 'Run Cell');
		}
	}

	/**
	 * Update rich tooltips when execution state changes.
	 */
	private _updateRichTooltips(): void {
		this._setupRichTooltips();
	}

	override dispose(): void {
		this._editor.removeOverlayWidget(this);
		super.dispose();
	}
}
