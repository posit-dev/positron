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
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { INotebookExecutionStateService } from 'vs/workbench/contrib/notebook/common/notebookExecutionStateService';
import { INotebookKernel } from 'vs/workbench/contrib/notebook/common/notebookKernelService';
import { URI } from 'vs/base/common/uri';

/**
 * The ReplInstanceView class is the view that hosts an individual REPL instance.
 */
export class ReplInstanceView extends Disposable {
	private _editor?: CodeEditorWidget;

	/** The language executed by this REPL */
	private readonly _language: string;

	/** The URI of the virtual notebook powering this instance */
	private readonly _uri: URI;

	constructor(private readonly _kernel: INotebookKernel,
		private readonly _parentElement: HTMLElement,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IModelService private readonly _modelService: IModelService,
		@ILanguageService private readonly _languageService: ILanguageService,
		@INotificationService private readonly _notificationService: INotificationService,
		@INotebookExecutionStateService private readonly _notebookExecutionStateService: INotebookExecutionStateService) {
		super();
		this._language = _kernel.supportedLanguages[0];
		this._uri = URI.parse('repl:' + this._language);
	}

	render() {
		const h1 = document.createElement('h3');
		h1.innerText = this._kernel.label;
		this._parentElement.appendChild(h1);

		const ed = document.createElement('div');

		// TODO: do not hardcode this
		ed.style.height = '2em';
		this._parentElement.appendChild(ed);

		// Create language selector
		const languageId = this._languageService.getLanguageIdByLanguageName(this._language);
		const languageSelection = this._languageService.createById(languageId);

		// Create text model
		const textModel = this._modelService.createModel('', // initial value
			languageSelection,  // language selection
			undefined,          // resource URI
			false               // mark for simple widget
		);

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

		// Create a CellExecution to track the execution of this input
		const cell = this._notebookExecutionStateService.getCellExecution(this._uri);
		if (!cell) {
			throw new Error('Cannot create cell execution state for code: ' + code);
		}
		const exe = this._notebookExecutionStateService.createCellExecution(this._uri, cell.cellHandle);

		this._notificationService.notify({
			severity: Severity.Info,
			message: `Submitting ${code} with handle ${exe.cellHandle}`
		});

		// Ask the kernel to execute the cell
		this._kernel.executeNotebookCellsRequest(this._uri, [exe.cellHandle]);
	}
}
