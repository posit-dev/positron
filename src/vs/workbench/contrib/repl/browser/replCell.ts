/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { IReplCancelExecutionEvent, IReplInputSubmitEvent, ReplInput } from 'vs/workbench/contrib/repl/browser/replInput';
import { ReplOutput } from 'vs/workbench/contrib/repl/browser/replOutput';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { IMouseWheelEvent } from 'vs/base/browser/mouseEvent';
import { HistoryNavigator2 } from 'vs/base/common/history';

/**
 * Legal states for the cell
 */
export enum ReplCellState {
	/** The cell is scheduled for execution, but has not executed yet. */
	ReplCellPending,

	/** The cell is awaiting user input. */
	ReplCellInput,

	/** The cell is currently executing the user input. */
	ReplCellExecuting,

	/** The user has requested that the execution be canceled. */
	ReplCellCancelling,

	/** The execution didn't complete because it was cancelled */
	ReplCellCompletedCancelled,

	/** The cell has successfully completed execution. */
	ReplCellCompletedOk,

	/** The cell failed to execute. */
	ReplCellCompletedFailure
}

/**
 * Data for events representing state transitions
 */
export interface IReplCellStateChange {
	oldState: ReplCellState;
	newState: ReplCellState;
}

/**
 * ReplCell represents a single iteration of a Read-Evaluate-Print-Loop (REPL).
 */
export class ReplCell extends Disposable {

	readonly onDidSubmitInput: Event<IReplInputSubmitEvent>;
	readonly onDidCancelExecution: Event<IReplCancelExecutionEvent>;
	readonly onMouseWheel: Event<IMouseWheelEvent>;
	readonly onDidChangeCellState: Event<IReplCellStateChange>;
	readonly onDidChangeHeight: Event<void>;
	private readonly _onDidChangeCellState;
	private readonly _onDidCancelExecution;

	private _container: HTMLElement;

	private _input: ReplInput;

	private _output: ReplOutput;

	private _handle: number;

	private _indicator: HTMLElement;

	private static _counter: number = 0;

	constructor(
		private readonly _languageId: string,
		private _state: ReplCellState,
		private readonly _history: HistoryNavigator2<string>,
		private readonly _parentElement: HTMLElement,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super();

		// Wire events
		this._onDidChangeCellState = this._register(new Emitter<IReplCellStateChange>());
		this.onDidChangeCellState = this._onDidChangeCellState.event;
		this.onDidChangeCellState((e) => {
			this.renderStateChange(e);
		});

		this._onDidCancelExecution = this._register(new Emitter<IReplCancelExecutionEvent>());
		this.onDidCancelExecution = this._onDidCancelExecution.event;

		// Create unique handle
		this._handle = ReplCell._counter++;

		// Create host element
		this._container = document.createElement('div');
		this._container.classList.add('repl-cell');

		// Create input
		this._input = this._instantiationService.createInstance(
			ReplInput,
			this._handle,
			this._languageId,
			this._history,
			this._container);
		this._register(this._input);
		this.onMouseWheel = this._input.onMouseWheel;

		// Create output
		this._output = this._instantiationService.createInstance(
			ReplOutput,
			this._container,
			this._input.getFontInfo());
		this._register(this._output);
		this.onDidChangeHeight = this._output.onDidChangeHeight;

		// Create indicator
		this._indicator = document.createElement('div');
		this._indicator.classList.add('repl-indicator');
		this._indicator.setAttribute('role', 'presentation');
		this._container.appendChild(this._indicator);

		// Create stop button with codicon
		const stopButton = document.createElement('button');
		stopButton.classList.add('repl-stop-button');
		stopButton.setAttribute('role', 'button');
		stopButton.setAttribute('aria-label', 'Cancel execution');
		const stopButtonIcon = document.createElement('span');
		stopButtonIcon.classList.add('codicon', 'codicon-stop');
		stopButton.appendChild(stopButtonIcon);
		this._container.appendChild(stopButton);

		// Wire stop button
		stopButton.addEventListener('click', (e) => {
			this.setState(ReplCellState.ReplCellCancelling);
			this._onDidCancelExecution.fire({});
		});

		// Event forwarding for input submission
		this.onDidSubmitInput = this._input.onDidSubmitInput;

		// Decorate with pending input state if cell is queued
		if (this._state === ReplCellState.ReplCellPending) {
			this._container.classList.add('repl-cell-pending');
		}

		// Inject the input/output pair to the parent
		this._parentElement.appendChild(this._container);
	}

	/**
	 * Emits output in the cell
	 *
	 * @param data A record containing the output data to emit; keys are output
	 *   mime types and values are the output data for that type
	 */
	emitMimeOutput(data: Record<string, string>) {
		for (const [mime, val] of Object.entries(data)) {
			let output = '';
			let error = false;
			let isText = true;
			if (mime === 'text/html') {
				this._output.emitHtml(val);
				isText = false;
			} else if (mime.startsWith('text')) {
				output = val;
			} else if (mime === 'application/vnd.code.notebook.stdout') {
				output = val;
			} else if (mime === 'application/vnd.code.notebook.stderr') {
				output = val;
				error = true;
			} else if (mime === 'application/vnd.code.notebook.error') {
				// TODO: the value is a JSON object with a message and stack;
				// parse it and display it
				this.emitError('', val, []);
				isText = false;
			} else {
				output = `Result type ${mime}`;
			}
			if (isText) {
				this._output.emitOutput(output, error);
			}
		}
	}

	/**
	 * Emits an error to the cell output
	 *
	 * @param name The error's name, if any
	 * @param message The full text of the error message
	 * @param traceback An array of strings containing the stack frames at the
	 *   time the error occurred
	 */
	public emitError(name: string, message: string, traceback: string[]) {
		this._output.emitError(message);
		this.setState(ReplCellState.ReplCellCompletedFailure);
	}

	/**
	 * Forward focus the cell's input control
	 */
	focusInput() {
		this._input.focus();
	}

	/**
	 * Forward focus the cell's output control
	 */
	focusOutput() {
		this._output.getDomNode().focus();
	}

	/**
	 * Sets the cell's new state, and fires an event to listeners
	 *
	 * @param newState The new state
	 */
	setState(newState: ReplCellState) {
		const oldState = this._state;
		this._state = newState;
		this._onDidChangeCellState.fire(<IReplCellStateChange>{
			oldState: oldState,
			newState: newState
		});
	}

	getState(): ReplCellState {
		return this._state;
	}

	getInput(): string {
		return this._input.getContent();
	}

	executeInput(code: string) {
		this._input.executeInput(code);
	}

	/**
	 * Returns a unique execution ID for the cell
	 */
	getExecutionId(): string {
		return `exec-${this._handle}`;
	}

	/**
	 * Checks the focus state of the cell.
	 *
	 * @returns Whether the underlying input control is focused
	 */
	hasFocus(): boolean {
		return this._input.hasFocus();
	}

	setContent(content: string) {
		this._input.setContent(content);
	}

	getDomNode(): HTMLElement {
		return this._container;
	}

	/**
	 * Redraws the cell to adapt to a change in state
	 *
	 * @param change The event that triggered the update
	 */
	private renderStateChange(change: IReplCellStateChange) {
		if (change.oldState === ReplCellState.ReplCellPending) {
			this._container.classList.remove('repl-cell-pending');
		}
		if (change.newState === ReplCellState.ReplCellExecuting) {
			this._input.setReadOnly(true);
			this._container.classList.add('repl-cell-executing');
		}
		else if (change.oldState === ReplCellState.ReplCellExecuting) {
			this._container.classList.remove('repl-cell-executing');
		}
	}
}
