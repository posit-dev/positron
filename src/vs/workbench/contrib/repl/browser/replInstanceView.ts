/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ILogService } from 'vs/platform/log/common/log';
import { DomScrollableElement } from 'vs/base/browser/ui/scrollbar/scrollableElement';
import { ScrollbarVisibility } from 'vs/base/common/scrollable';
import { ReplCell, ReplCellState } from 'vs/workbench/contrib/repl/browser/replCell';
import { IReplInstance } from 'vs/workbench/contrib/repl/browser/repl';
import { ILanguageRuntime, ILanguageRuntimeOutput, ILanguageRuntimeState, LanguageRuntimeMessageType, RuntimeOnlineState } from 'vs/workbench/contrib/languageRuntime/common/languageRuntimeService';

export const REPL_NOTEBOOK_SCHEME = 'repl';

/**
 * The ReplInstanceView class is the view that hosts an individual REPL instance.
 */
export class ReplInstanceView extends Disposable {

	/** The language executed by this REPL */
	private readonly _language: string;

	/** The scrolling element that hosts content */
	private _scroller: DomScrollableElement;

	/** The root container HTML element (sits inside the scrollable area) */
	private _root: HTMLElement;

	/** The HTML element containing all of the REPL cells */
	private _cellContainer: HTMLElement;

	/** An array of all REPL cells */
	private _cells: Array<ReplCell> = [];

	/** An array of REPL cells that are awaiting execution */
	private _pendingCells: Array<ReplCell> = [];

	/** The currently active REPL cell */
	private _activeCell?: ReplCell;

	/** The language runtime kernel to which the REPL is bound */
	private _kernel: ILanguageRuntime;

	/** Whether we had focus when the last code execution occurred */
	private _hadFocus: boolean = false;

	constructor(private readonly _instance: IReplInstance,
		private readonly _parentElement: HTMLElement,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILogService private readonly _logService: ILogService) {
		super();
		this._kernel = this._instance.kernel;

		this._language = this._kernel.language;

		this._root = document.createElement('div');
		this._root.classList.add('repl-root');
		this._scroller = new DomScrollableElement(this._root, {
			horizontal: ScrollbarVisibility.Hidden,
			vertical: ScrollbarVisibility.Auto
		});
		this._scroller.getDomNode().appendChild(this._root);
		this._scroller.getDomNode().style.height = '100%';

		// Create cell host element
		this._cellContainer = document.createElement('div');
		this._cellContainer.classList.add('repl-cells');
		this._cellContainer.addEventListener('click', (ev) => {
			if (this._activeCell) {
				this._activeCell.focus();
			}
		});

		// Listen for execution state changes
		this._kernel.messages.event((msg) => {
			if (msg.type === LanguageRuntimeMessageType.State) {
				const stateMsg = msg as ILanguageRuntimeState;

				// If the kernel is entering a busy state, ignore for now
				if (stateMsg.state === RuntimeOnlineState.Busy) {
					return;
				}

				// If the active cell isn't executing, ignore this execution state change
				if (this._activeCell?.getState() !== ReplCellState.ReplCellExecuting) {
					return;
				}

				// Mark the current cell execution as complete, if it is currently executing.
				if (this._activeCell?.getState() === ReplCellState.ReplCellExecuting) {
					this._activeCell.setState(ReplCellState.ReplCellCompletedOk);
				}

				// Now that the cell execution is complete, try to process any
				// pending input; if there is none, add a new cell.
				if (!this.processQueue()) {
					this.addCell(this._hadFocus);
				}
			} else if (msg.type === LanguageRuntimeMessageType.Output) {
				const outputMsg = msg as ILanguageRuntimeOutput;
				this._activeCell?.emitMimeOutput(outputMsg.data);
			}

			this.scrollToBottom();
		});

		// Clear REPL when event signals the user has requested it
		this._instance.onDidClearRepl(() => {
			this.clear();
		});

		// Execute code when the user requests it
		this._instance.onDidExecuteCode((code: string) => {
			this.execute(code);
		});
	}

	/**
	 *
	 * @returns Whether any work was removed from the execution queue
	 */
	private processQueue(): boolean {
		// No cells pending
		if (this._pendingCells.length === 0) {
			return false;
		}

		// Pull first pending cell off the list and tell it to run itself; move
		// it from the set of pending cells to the set of running cells
		const cell = this._pendingCells.shift()!;
		this._cells.push(cell);
		this._activeCell = cell;
		cell.executeInput(cell.getInput());

		return true;
	}

	/**
	 * Executes code from an external source
	 *
	 * @param code The code to execute
	 */
	execute(code: string) {
		if (this._activeCell) {
			if (this._activeCell.getState() === ReplCellState.ReplCellInput) {
				// If we have a cell awaiting input, then use it to execute the
				// requested input.
				//
				// TODO: this obliterates any draft statement the user might
				// have in the input. If the user has content in the cell, we
				// should preserve it in some way.
				this._activeCell.executeInput(code);
			} else {
				// We are likely executing code; wait until it's done.
				this.addPendingCell(code);
			}
		} else {
			this._logService.warn(`Attempt to execute '${code}', but console is not able to receive input.`);
		}
	}

	/**
	 * Clears the REPL by removing all rendered content
	 */
	clear() {
		// Check to see if the current cell has focus (so we can restore it
		// after clearing if necessary)
		let focus = false;
		if (this._activeCell) {
			focus = this._activeCell.hasFocus();
		}

		// Is the active cell currently executing code? If it is, we don't want
		// to blow away a running computation.
		const exeCell =
			this._activeCell?.getState() === ReplCellState.ReplCellExecuting ?
				this._activeCell : null;

		// Dispose all existing cells, both those currently in the DOM and those
		// that are pending.
		for (const cell of this._cells) {
			if (cell !== exeCell) {
				cell.dispose();
			}
		}
		this._cells = [];
		for (const cell of this._pendingCells) {
			cell.dispose();
		}
		this._pendingCells = [];

		// Clear the DOM by removing all child elements. Note that we can't just
		// set innerHTML to an empty string, because Electron requires the
		// TrustedHTML claim to be set for innerHTML.
		for (let i = this._cellContainer.children.length - 1; i >= 0; i--) {
			this._cellContainer.removeChild(this._cellContainer.children[i]);
		}

		if (exeCell) {
			// If we had an actively executing cell, put it back in the DOM
			this._cellContainer.appendChild(exeCell.getDomNode());
		} else {
			// If we didn't, we no longer have any cells; add one.
			this._activeCell = undefined;
			this.addCell(focus);
		}

		// Rescan DOM so scroll region adapts to new size of cell list
		this._scroller.scanDomNode();
	}

	render() {
		this._parentElement.appendChild(this._scroller.getDomNode());

		const h1 = document.createElement('h1');
		h1.innerText = this._kernel.name;
		this._root.appendChild(h1);
		this._root.appendChild(this._cellContainer);

		// Create first cell
		this.addCell(true);

		// Recompute scrolling
		this._scroller.scanDomNode();

		this._kernel.messages.event(msg => {
		});
	}

	/**
	 * Submits code in the REPL
	 *
	 * @param code The code to submit
	 */
	submit(code: string) {
		// Push the submitted code into the history
		this._instance.history.add(code);

		// Ask the kernel to execute the code
		this._kernel.execute(code);

		// Mark the cell as executing
		if (this._activeCell) {
			this._activeCell.setState(ReplCellState.ReplCellExecuting);
		}
		this.scrollToBottom();
	}

	/**
	 * Scrolls the REPL to the bottom, to show new output or the input prompt.
	 */
	scrollToBottom() {
		this._scroller.scanDomNode();
		this._scroller.setScrollPosition({ scrollTop: this._root.scrollHeight });
	}

	/**
	 * Adds a new cell to the end of the REPL, and makes it the primary cell
	 *
	 * @param focus Whether to send focus to the newly added cell
	 */
	addCell(focus: boolean) {
		// Create the new cell
		const cell = this._instantiationService.createInstance(ReplCell,
			this._language,
			ReplCellState.ReplCellInput,
			this._instance.history,
			this._cellContainer);
		this._cells.push(cell);
		this.registerCellEvents(cell);

		// Reset the instance's history cursor so that navigating history in the
		// new cell will start from the right place
		this._instance.history.resetCursor();

		this._activeCell = cell;
		if (focus) {
			cell.focus();
		}
	}

	private addPendingCell(contents: string) {
		// Create the new cell
		const cell = this._instantiationService.createInstance(ReplCell,
			this._language,
			ReplCellState.ReplCellPending,
			this._instance.history,
			this._cellContainer);
		cell.setContent(contents);
		this._pendingCells.push(cell);
		this.registerCellEvents(cell);
		this.scrollToBottom();
	}

	private registerCellEvents(cell: ReplCell) {
		// Register with disposable chain
		this._register(cell);

		// Forward scroll events from inside REPL cells into the outer scrolling
		// container (so input editors inside cells do not create a scroll trap)
		cell.onMouseWheel((e) => {
			this._scroller.triggerScrollFromMouseWheelEvent(e);
		});

		// Hook up events
		cell.onDidSubmitInput((e) => {
			this.submit(e.code);
			this._hadFocus = e.focus;
		});

		cell.onDidChangeHeight(() => {
			this._scroller.scanDomNode();
		});
	}
}
