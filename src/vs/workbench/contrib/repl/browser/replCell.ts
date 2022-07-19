/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { IReplInputSubmitEvent, ReplInput } from 'vs/workbench/contrib/repl/browser/replInput';
import { ReplOutput } from 'vs/workbench/contrib/repl/browser/replOutput';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { NotebookCellOutputsSplice } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { applyFontInfo } from 'vs/editor/browser/config/domFontInfo';
import { IMouseWheelEvent } from 'vs/base/browser/mouseEvent';

/**
 * Legal states for the cell
 */
export enum ReplCellState {
	/** The cell is awaiting user input. */
	ReplCellInput,

	/** The cell is currently executing the user input. */
	ReplCellExecuting,

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
	readonly onMouseWheel: Event<IMouseWheelEvent>;
	readonly onDidChangeCellState: Event<IReplCellStateChange>;
	private readonly _onDidChangeCellState;

	private _container: HTMLElement;

	private _input: ReplInput;

	private _output: ReplOutput;

	private _handle: number;

	private _state: ReplCellState;

	private static _counter: number = 0;

	constructor(
		private readonly _language: string,
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

		// Set intial state
		this._state = ReplCellState.ReplCellInput;

		// Create unique handle
		this._handle = ReplCell._counter++;

		// Create host element
		this._container = document.createElement('div');
		this._container.classList.add('repl-cell');

		// Create input
		this._input = this._instantiationService.createInstance(
			ReplInput,
			this._handle,
			this._language,
			this._container);
		this._register(this._input);
		this.onMouseWheel = this._input.onMouseWheel;

		// Create output
		this._output = this._instantiationService.createInstance(
			ReplOutput,
			this._container);
		this._register(this._output);

		// Copy the editor's font settings to the output area
		const fontInfo = this._input.getFontInfo();
		applyFontInfo(this._output.getDomNode(), fontInfo);

		// Event forwarding for input submission
		this.onDidSubmitInput = this._input.onDidSubmitInput;
		this._register(this.onDidSubmitInput((e) => {
			// If the input had focus, drive it out
			if (e.focus) {
				this._output.getDomNode().focus();
			}
		}));

		// Inject the input/output pair to the parent
		this._parentElement.appendChild(this._container);
	}

	/**
	 * Updates output in the cell
	 *
	 * @param splice The cell output updates
	 */
	changeOutput(splice: NotebookCellOutputsSplice) {
		for (const output of splice.newOutputs) {
			for (const o of output.outputs) {
				let output = '';
				let error = false;
				let isText = true;
				if (o.mime === 'text/html') {
					this._output.emitHtml(o.data.toString());
					isText = false;
				} else if (o.mime.startsWith('text')) {
					output = o.data.toString();
				} else if (o.mime === 'application/vnd.code.notebook.stdout') {
					output = o.data.toString();
				} else if (o.mime === 'application/vnd.code.notebook.stderr') {
					output = o.data.toString();
					error = true;
				} else if (o.mime === 'application/vnd.code.notebook.error') {
					this._output.emitError(o.data.toString());
					this.setState(ReplCellState.ReplCellCompletedFailure);
					isText = false;
				} else {
					output = `Result type ${o.mime}`;
				}
				if (isText) {
					this._output.emitOutput(output, error);
				}
			}
		}
	}

	/**
	 * Forward focus the cell's input control
	 */
	focus() {
		this._input.focus();
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

	executeInput(code: string) {
		this._input.executeInput(code);
	}

	/**
	 * Checks the focus state of the cell.
	 *
	 * @returns Whether the underlying input control is focused
	 */
	hasFocus(): boolean {
		return this._input.hasFocus();
	}

	/**
	 * Redraws the cell to adapt to a change in state
	 *
	 * @param change The event that triggered the update
	 */
	private renderStateChange(change: IReplCellStateChange) {
		if (change.newState === ReplCellState.ReplCellExecuting) {
			this._input.setReadOnly(true);
		}
	}
}
