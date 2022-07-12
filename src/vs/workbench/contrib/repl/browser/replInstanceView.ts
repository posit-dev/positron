/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { IKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { KeyCode } from 'vs/base/common/keyCodes';
import { Disposable } from 'vs/base/common/lifecycle';
import { IEditorConstructionOptions } from 'vs/editor/browser/config/editorConfiguration';
import { CodeEditorWidget, ICodeEditorWidgetOptions } from 'vs/editor/browser/widget/codeEditorWidget';
import { IEditorMinimapOptions, IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { IModelService } from 'vs/editor/common/services/model';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { INotebookExecutionStateService } from 'vs/workbench/contrib/notebook/common/notebookExecutionStateService';
import { INotebookKernel, INotebookKernelService } from 'vs/workbench/contrib/notebook/common/notebookKernelService';
import { URI } from 'vs/base/common/uri';
import { CellEditType, CellKind } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { ILogService } from 'vs/platform/log/common/log';

export const REPL_NOTEBOOK_SCHEME = 'repl';

/**
 * The ReplInstanceView class is the view that hosts an individual REPL instance.
 */
export class ReplInstanceView extends Disposable {
	private _editor?: CodeEditorWidget;

	/** The language executed by this REPL */
	private readonly _language: string;

	/** The URI of the virtual notebook powering this instance */
	private readonly _uri: URI;

	/** The notebook text model */
	private _nbTextModel?: NotebookTextModel;

	private _output: HTMLElement;

	constructor(private readonly _kernel: INotebookKernel,
		private readonly _parentElement: HTMLElement,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IModelService private readonly _modelService: IModelService,
		@ILanguageService private readonly _languageService: ILanguageService,
		@INotebookExecutionStateService private readonly _notebookExecutionStateService: INotebookExecutionStateService,
		@INotebookKernelService private readonly _notebookKernelService: INotebookKernelService,
		@INotebookService private readonly _notebookService: INotebookService,
		@ILogService private readonly _logService: ILogService) {
		super();
		this._language = _kernel.supportedLanguages[0];
		this._uri = URI.parse('repl:///' + this._language);
		this._output = document.createElement('div');
	}

	render() {
		const h3 = document.createElement('h3');
		h3.innerText = this._kernel.label;
		this._parentElement.appendChild(h3);
		this._parentElement.appendChild(this._output);

		const ed = document.createElement('div');

		// TODO: do not hardcode this
		ed.style.height = '2em';
		this._parentElement.appendChild(ed);

		// Create language selector
		const languageId = this._languageService.getLanguageIdByLanguageName(this._language);
		const languageSelection = this._languageService.createById(languageId);

		// Create text model; this is the backing store for the Monaco editor that receives
		// the user's input
		const textModel = this._modelService.createModel('', // initial value
			languageSelection,  // language selection
			undefined,          // resource URI
			false               // mark for simple widget
		);

		// TODO: do we need to cache or store this?
		this._nbTextModel = this._notebookService.createNotebookTextModel(
			// TODO: do we need our own view type? seems ideal
			'interactive',
			this._uri,
			{
				cells: [{
					source: '',
					language: this._language,
					mime: `text/${this._language}`,
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

		// Create editor
		const editorConstructionOptions = <IEditorConstructionOptions>{};

		const widgetOptions = <ICodeEditorWidgetOptions>{
			isSimpleWidget: false
		};

		this._editor = this._instantiationService.createInstance(
			CodeEditorWidget,
			ed,
			editorConstructionOptions,
			widgetOptions);

		this._register(this._editor);

		this._editor.setModel(textModel);
		this._editor.onKeyDown((e: IKeyboardEvent) => {
			if (e.keyCode === KeyCode.Enter) {
				this.submit();
			}
		});

		// Turn off most editor chrome so we can host in the REPL
		const editorOptions = <IEditorOptions>{
			lineNumbers: 'off',
			minimap: <IEditorMinimapOptions>{
				enabled: false
			},
			overviewRuleBorder: false,
			enableDropIntoEditor: false,
			renderLineHighlight: 'none'
		};
		this._editor.updateOptions(editorOptions);

		// Lay out editor in DOM
		this._editor.layout();
	}

	submit() {
		const code = this._editor?.getValue();
		if (!code) {
			throw new Error('Attempt to submit without code');
		}

		// Clear the submitted code from the editor and place it in the execution region
		this._editor?.setValue('');
		const pre = document.createElement('pre');
		pre.innerText = code;
		this._output.appendChild(pre);

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
			this._logService.debug('Cell changed output: ', e);
			for (const output of e.newOutputs) {
				for (const o of output.outputs) {
					const p = document.createElement('pre');
					if (o.mime.startsWith('text')) {
						p.innerText = o.data.toString();
					} else {
						p.innerText = `Result type ${o.mime}`;
					}
					this._output.appendChild(p);
				}
			}
		});

		// Create a CellExecution to track the execution of this input
		const exe = this._notebookExecutionStateService.createCellExecution(this._uri, cell.handle);
		if (!exe) {
			throw new Error(`Cannot create cell execution state for code: ${code}`);
		}

		// Ask the kernel to execute the cell
		this._kernel.executeNotebookCellsRequest(this._uri, [exe.cellHandle]);
	}
}
