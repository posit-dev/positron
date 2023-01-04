/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ILogService } from 'vs/platform/log/common/log';
import { DomScrollableElement } from 'vs/base/browser/ui/scrollbar/scrollableElement';
import { ScrollbarVisibility } from 'vs/base/common/scrollable';
import { ReplCell, ReplCellState } from 'vs/workbench/contrib/repl/browser/replCell';
import { IReplInstance } from 'vs/workbench/contrib/repl/browser/repl';
import { ILanguageRuntime, ILanguageRuntimeError, ILanguageRuntimeEvent, ILanguageRuntimeOutput, ILanguageRuntimePrompt, ILanguageRuntimeState, LanguageRuntimeMessageType, RuntimeCodeExecutionMode, RuntimeCodeFragmentStatus, RuntimeErrorBehavior, RuntimeOnlineState, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { ReplStatusMessage } from 'vs/workbench/contrib/repl/browser/replStatusMessage';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import Severity from 'vs/base/common/severity';
import { LanguageRuntimeEventType, ShowMessageEvent } from 'vs/workbench/services/languageRuntime/common/languageRuntimeEvents';

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

	/** The HTML element containing the startup banner */
	private _bannerContainer: HTMLElement;

	/** An array of all REPL cells */
	private _cells: Array<ReplCell> = [];

	/** An array of REPL cells that are awaiting execution */
	private _pendingCells: Array<ReplCell> = [];

	/** The currently active REPL cell */
	private _activeCell?: ReplCell;

	/** A map of execution IDs to the cells containing the output from the execution */
	private _executedCells: Map<string, ReplCell> = new Map();

	/** The language runtime kernel to which the REPL is bound */
	private _kernel: ILanguageRuntime;

	/** Whether we had focus when the last code execution occurred */
	private _hadFocus: boolean = false;

	/** The state of the kernel */
	private _kernelState: RuntimeState = RuntimeState.Uninitialized;

	constructor(private readonly _instance: IReplInstance,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
		@IDialogService private readonly _dialogService: IDialogService) {
		super();
		this._kernel = this._instance.kernel;

		this._language = this._kernel.metadata.language;

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

		// Create element for banner
		this._bannerContainer = document.createElement('div');
		this._bannerContainer.classList.add('repl-banner');

		// Listen for execution state changes
		this._kernel.onDidReceiveRuntimeMessage((msg) => {
			if (msg.type === LanguageRuntimeMessageType.State) {
				const stateMsg = msg as ILanguageRuntimeState;

				// If the kernel is entering a busy state, ignore for now
				if (stateMsg.state === RuntimeOnlineState.Busy) {
					return;
				}

				// Mark the current cell execution as complete, if it is currently executing.
				if (this._activeCell?.getState() === ReplCellState.ReplCellExecuting) {
					this._activeCell.setState(ReplCellState.ReplCellCompletedOk);
				}

				// Now that the cell execution is complete, try to process any
				// pending input; if there is none, add a new cell if there aren't
				// any cells or if the last cell is complete.
				if (!this.processQueue() && (
					!this._activeCell ||
					this._activeCell.getState() !== ReplCellState.ReplCellInput)) {
					this.addCell(this._hadFocus);
				}
			} else if (msg.type === LanguageRuntimeMessageType.Output) {
				const outputMsg = msg as ILanguageRuntimeOutput;

				// Look up the cell with which this output is associated
				const cell = this._executedCells.get(outputMsg.parent_id);
				if (cell) {
					cell.emitMimeOutput(outputMsg.data);
				} else {
					this._logService.warn(`Received output ${JSON.stringify(outputMsg)} for unknown code execution ${outputMsg.parent_id}`);
				}
			} else if (msg.type === LanguageRuntimeMessageType.Error) {
				const errMsg = msg as ILanguageRuntimeError;

				// Look up the cell with which this error is associated
				const cell = this._executedCells.get(errMsg.parent_id);
				if (cell) {
					cell.emitError(errMsg.name, errMsg.message, errMsg.traceback);
				} else {
					this._logService.warn(`Received error ${JSON.stringify(errMsg)} for unknown code execution ${errMsg.parent_id}`);
				}
			} else if (msg.type === LanguageRuntimeMessageType.Event) {
				const evt = msg as ILanguageRuntimeEvent;
				if (evt.name === LanguageRuntimeEventType.ShowMessage) {
					const data = evt.data as ShowMessageEvent;
					const msg = new ReplStatusMessage(
						'info', `${data.message}`);
					msg.render(this._cellContainer);
				}
			} else if (msg.type === LanguageRuntimeMessageType.Prompt) {
				this.showPrompt(msg as ILanguageRuntimePrompt);
			}

			this.scrollToBottom();
		});

		// Show startup banner when kernel finishes starting
		this._kernel.onDidCompleteStartup(info => {
			this._bannerContainer.innerText = info.banner;
			this._scroller.scanDomNode();
		});

		this._kernel.onDidChangeRuntimeState((state) => {
			this.renderStateChange(state);
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

	/**
	 * Renders the REPL into the provided container
	 *
	 * @param parent The parent element to which the REPL should be attached
	 */
	public render(parent: HTMLElement): void {
		parent.appendChild(this._scroller.getDomNode());

		this._root.appendChild(this._bannerContainer);
		this._root.appendChild(this._cellContainer);

		// Create first cell
		this.addCell(true);

		// Recompute scrolling
		this._scroller.scanDomNode();
		this.scrollToBottom();
	}

	/**
	 * Submits code in the REPL after testing it for completeness
	 *
	 * @param code The code to submit
	 */
	submit(code: string) {
		// Ask the kernel to determine whether the code fragment is a complete expression
		this._kernel.isCodeFragmentComplete(code).then((result) => {
			if (result === RuntimeCodeFragmentStatus.Complete) {
				// Code is complete; we can run it as is
				this.executeCode(code);
			} else if (result === RuntimeCodeFragmentStatus.Incomplete) {
				// TODO (jmcphers): handle incomplete code fragments
			} else if (result === RuntimeCodeFragmentStatus.Invalid) {
				// If the code is invalid (contains syntax errors), warn but
				// execute it anyway (so the user can see a syntax error from
				// the interpreter)
				this._logService.warn(`Execute invalid code fragment '${code}'`);
				this.executeCode(code);
			} else if (result === RuntimeCodeFragmentStatus.Unknown) {
				// If we can't determine the status, warn but execute it anyway
				this._logService.warn(`Could not determine fragment completion status for '${code}'`);
				this.executeCode(code);
			}
		});
	}

	private executeCode(code: string) {
		// Push the submitted code into the history
		this._instance.history.add(code);

		// Ask the kernel to execute the code
		const cell = this._activeCell!;
		this._executedCells.set(cell.getExecutionId(), cell);
		this._kernel.execute(code,
			cell.getExecutionId(),
			RuntimeCodeExecutionMode.Interactive,
			RuntimeErrorBehavior.Stop);

		// Mark the cell as executing
		cell.setState(ReplCellState.ReplCellExecuting);
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

	/**
	 * Consume focus
	 */
	takeFocus() {
		if (this._activeCell) {
			this._activeCell.focus();
		}
		this._scroller.scanDomNode();
		this.scrollToBottom();
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
			this._scroller.delegateScrollFromMouseWheelEvent(e);
		});

		// Hook up events
		cell.onDidSubmitInput((e) => {
			this.submit(e.code);
			this._hadFocus = e.focus;
		});

		cell.onDidChangeHeight(() => {
			this._scroller.scanDomNode();
		});

		cell.onDidCancelExecution(() => {
			this._kernel.interrupt();
		});
	}

	/**
	 *
	 * @param prompt The prompt to display
	 */
	private showPrompt(prompt: ILanguageRuntimePrompt) {
		this._dialogService.input(
			Severity.Info,
			prompt.prompt,
			[], // Buttons
			[{
				type: prompt.password ? 'password' : 'text',
			}]
		).then((result) => {
			if (result &&
				result.values &&
				result.values.length > 0 &&
				result.values[0]) {
				this._kernel.replyToPrompt(prompt.id, result.values[0]);
			} else {
				this._kernel.replyToPrompt(prompt.id, '');
			}
		});
	}

	/**
	 * Updates the rendered instance view to display the current state of the
	 * language runtime.
	 *
	 * @param state The new runtime state
	 */
	private renderStateChange(state: RuntimeState) {
		// Update kernel state
		const oldState = this._kernelState;
		this._kernelState = state;

		if (state === RuntimeState.Starting) {
			// If the kernel is entering the Starting state but was previously in
			// the Exiting state, it must have restarted; otherwise it would have
			// been in the Exited state.
			//
			// Consider: We may need a special state for "restarting" to
			// distinguish it from "exiting".
			if (oldState === RuntimeState.Exiting) {

				// If we had an active cell waiting for input, clean it up so we
				// can insert the status message beneath it.  A new cell will be
				// created momentarily when the kernel finishes starting.
				if (this._activeCell && this._activeCell.getState() === ReplCellState.ReplCellInput) {
					this._hadFocus = this._activeCell.hasFocus();
					this._activeCell.getDomNode().remove();
					this._activeCell = undefined;
				}
				const msg = new ReplStatusMessage(
					'refresh', `${this._kernel.metadata.name} restarting`);
				msg.render(this._cellContainer);
			}
		}
		else if (state === RuntimeState.Ready) {
			// The language runtime is ready to execute code. If there's
			// already a cell ready and awaiting input, leave it alone.
			if (this._activeCell && this._activeCell.getState() === ReplCellState.ReplCellInput) {
				return;
			}

			// Otherwise, we have just finished restarting. Add an informative
			// message and a new cell to accept the first input in the new
			// session.
			const msg = new ReplStatusMessage(
				'check-all', `${this._kernel.metadata.name} started`);
			msg.render(this._cellContainer);

			this.addCell(this._hadFocus);
		}
		else if (state === RuntimeState.Exited ||
			state === RuntimeState.Offline) {

			const cell = this._activeCell;

			// Mark the current cell execution as cancelled, if it is
			// currently executing.
			if (cell && cell.getState() === ReplCellState.ReplCellExecuting) {
				cell.setState(ReplCellState.ReplCellCompletedCancelled);
			}

			if (state === RuntimeState.Exited) {
				const msg = new ReplStatusMessage(
					'info', `${this._kernel.metadata.name} exited`);
				msg.render(this._cellContainer);
			}

			if (state === RuntimeState.Offline) {
				const msg = new ReplStatusMessage(
					'debug-disconnect', `${this._kernel.metadata.name} is offline`);
				msg.render(this._cellContainer);
			}
		}

		this.scrollToBottom();
	}
}
