/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/repl';
import { Disposable } from 'vs/base/common/lifecycle';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { INotebookExecutionStateService } from 'vs/workbench/contrib/notebook/common/notebookExecutionStateService';
import { INotebookKernel, INotebookKernelService } from 'vs/workbench/contrib/notebook/common/notebookKernelService';
import { URI } from 'vs/base/common/uri';
import { CellEditType, CellKind } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { ILogService } from 'vs/platform/log/common/log';
import { DomScrollableElement } from 'vs/base/browser/ui/scrollbar/scrollableElement';
import { ScrollbarVisibility } from 'vs/base/common/scrollable';
import { ReplCell, ReplCellState } from 'vs/workbench/contrib/repl/browser/replCell';
import { IReplInstance } from 'vs/workbench/contrib/repl/browser/repl';

export const REPL_NOTEBOOK_SCHEME = 'repl';

/**
 * The ReplInstanceView class is the view that hosts an individual REPL instance.
 */
export class ReplInstanceView extends Disposable {

	/** The language executed by this REPL */
	private readonly _language: string;

	/** The URI of the virtual notebook powering this instance */
	private readonly _uri: URI;

	/** The notebook text model */
	private _nbTextModel?: NotebookTextModel;

	/** The scrolling element that hosts content */
	private _scroller: DomScrollableElement;

	/** The root container HTML element (sits inside the scrollable area) */
	private _root: HTMLElement;

	/** The HTML element containing all of the REPL cells */
	private _cellContainer: HTMLElement;

	/** The currently active REPL cell */
	private _activeCell?: ReplCell;

	/** The notebook kernel to which the REPL is bound */
	private _kernel: INotebookKernel;

	constructor(private readonly _instance: IReplInstance,
		private readonly _parentElement: HTMLElement,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@INotebookExecutionStateService private readonly _notebookExecutionStateService: INotebookExecutionStateService,
		@INotebookKernelService private readonly _notebookKernelService: INotebookKernelService,
		@INotebookService private readonly _notebookService: INotebookService,
		@ILogService private readonly _logService: ILogService) {
		super();
		this._kernel = this._instance.kernel;

		this._language = this._kernel.supportedLanguages[0];
		this._uri = URI.parse('repl:///' + this._language);

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
		this._notebookExecutionStateService.onDidChangeCellExecution((e) => {
			// When execution is complete, show the prompt again
			if (e.affectsNotebook(this._uri)) {
				if (typeof e.changed === 'undefined') {
					this._logService.info(`Cell execution of ${e.cellHandle} complete`);

					// Mark the current cell execution as complete, if it is currently executing.
					if (this._activeCell?.getState() === ReplCellState.ReplCellExecuting) {
						this._activeCell.setState(ReplCellState.ReplCellCompletedOk);
					}

					// Add a new cell and scroll to the bottom so the user can see it
					this.addCell();
					this.scrollToBottom();
				} else {
					this._logService.info(`Cell execution status: `, e.changed);
				}
			}
		});
	}

	render() {
		this._parentElement.appendChild(this._scroller.getDomNode());

		const h1 = document.createElement('h1');
		h1.innerText = this._kernel.label;
		this._root.appendChild(h1);
		this._root.appendChild(this._cellContainer);

		// Create first cell
		this.addCell();

		// TODO: do we need to cache or store this?
		this._nbTextModel = this._notebookService.createNotebookTextModel(
			// TODO: do we need our own view type? seems ideal
			'interactive',
			this._uri,
			{
				cells: [{
					source: '',
					language: this._language,
					mime: `application/${this._language}`,
					cellKind: CellKind.Code,
					outputs: [],
					metadata: {}
				}],
				metadata: {}
			}, // data
			{
				transientOutputs: false,
				transientCellMetadata: {},
				transientDocumentMetadata: {}
			} // options
		);

		// Bind the kernel we were given to the notebook text model we just created
		this._notebookKernelService.selectKernelForNotebook(this._kernel, this._nbTextModel);

		// Recompute scrolling
		this._scroller.scanDomNode();
	}

	/**
	 * Submits code in the REPL
	 *
	 * @param code The code to submit
	 */
	submit(code: string) {

		// Replace the "cell" contents with what the user entered
		this._nbTextModel?.applyEdits([{
			editType: CellEditType.Replace,
			cells: [{
				source: code,
				language: this._language,
				mime: `text/${this._language}`,
				cellKind: CellKind.Code,
				outputs: [],
				metadata: {}
			}],
			count: 1,
			index: 0
		}],
			true, // Synchronous
			undefined,
			() => undefined,
			undefined,
			false);

		const cell = this._nbTextModel?.cells[0]!;

		cell.onDidChangeOutputs((e) => {
			if (this._activeCell) {
				this._activeCell.changeOutput(e);
			}

			// TODO: only do this if already scrolled to bottom
			this.scrollToBottom();
		});

		// Create a CellExecution to track the execution of this input
		const exe = this._notebookExecutionStateService.createCellExecution(this._uri, cell.handle);
		if (!exe) {
			throw new Error(`Cannot create cell execution state for code: ${code}`);
		}

		// Ask the kernel to execute the cell
		this._kernel.executeNotebookCellsRequest(this._uri, [exe.cellHandle]);

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
	 */
	addCell() {
		// Create the new cell
		const cell = this._instantiationService.createInstance(ReplCell,
			this._language,
			this._cellContainer);
		this._register(cell);

		// Hook up events
		cell.onDidSubmitInput((e) => {
			this.submit(e.code);
		});

		this._activeCell = cell;
		cell.focus();
	}
}
