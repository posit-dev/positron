/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/repl';
import { IKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { KeyCode } from 'vs/base/common/keyCodes';
import { Disposable } from 'vs/base/common/lifecycle';
import { IEditorConstructionOptions } from 'vs/editor/browser/config/editorConfiguration';
import { CodeEditorWidget, ICodeEditorWidgetOptions } from 'vs/editor/browser/widget/codeEditorWidget';
import { IEditorMinimapOptions, IEditorOptions, EditorOption } from 'vs/editor/common/config/editorOptions';
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
import { applyFontInfo } from 'vs/editor/browser/config/domFontInfo';
import { errorForeground } from 'vs/platform/theme/common/colorRegistry';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { DomScrollableElement } from 'vs/base/browser/ui/scrollbar/scrollableElement';
import { ScrollbarVisibility } from 'vs/base/common/scrollable';

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

	/** The HTML element hosting the output area */
	private _output: HTMLElement;

	/** The HTML element hosting the Monaco editor instance */
	private _editorHost: HTMLElement;

	/** The root container HTML element */
	private _root: HTMLElement;

	/** The scrolling element that hosts content */
	private _scroller: DomScrollableElement;

	constructor(private readonly _kernel: INotebookKernel,
		private readonly _parentElement: HTMLElement,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IModelService private readonly _modelService: IModelService,
		@ILanguageService private readonly _languageService: ILanguageService,
		@INotebookExecutionStateService private readonly _notebookExecutionStateService: INotebookExecutionStateService,
		@INotebookKernelService private readonly _notebookKernelService: INotebookKernelService,
		@INotebookService private readonly _notebookService: INotebookService,
		@ILogService private readonly _logService: ILogService,
		@IThemeService private readonly _themeService: IThemeService) {
		super();
		this._language = _kernel.supportedLanguages[0];
		this._uri = URI.parse('repl:///' + this._language);

		this._root = document.createElement('div');
		this._root.classList.add('repl-root');
		this._scroller = new DomScrollableElement(this._root, {});
		this._scroller.getDomNode().appendChild(this._root);
		this._scroller.getDomNode().style.height = '100%';

		// Create output host element
		this._output = document.createElement('div');
		this._output.classList.add('repl-output');

		// Create editor host element
		this._editorHost = document.createElement('div');
		this._editorHost.classList.add('repl-editor-host');

		// Listen for execution state changes
		this._notebookExecutionStateService.onDidChangeCellExecution((e) => {
			// When execution is complete, show the prompt again
			if (e.affectsNotebook(this._uri)) {
				if (typeof e.changed === 'undefined') {
					this._logService.info(`Cell execution of ${e.cellHandle} complete`);
					this._editorHost.classList.remove('repl-editor-hidden');
					this._editor?.layout();

					// TODO: this could steal focus; probably don't do it if
					// focus is in another pane
					this._editor?.focus();

					this.scrollToBottom();
				} else {
					this._logService.info(`Cell execution status: `, e.changed);
				}
			}
		});
	}

	render() {
		this._parentElement.appendChild(this._scroller.getDomNode());

		const h3 = document.createElement('h3');
		h3.innerText = this._kernel.label;
		this._root.appendChild(h3);
		this._root.appendChild(this._output);

		// TODO: do not hardcode this
		this._editorHost.classList.add('repl-editor');
		this._root.appendChild(this._editorHost);

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
			this._editorHost,
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
			lineNumbers: (n: number) => {
				// Render the prompt as > for the first line; do not render
				// anything in the margin for following lines
				if (n < 2) {
					return '>';
				}
				return '';
			},
			minimap: <IEditorMinimapOptions>{
				enabled: false
			},
			glyphMargin: false,
			lineDecorationsWidth: 0,
			overviewRuleBorder: false,
			enableDropIntoEditor: false,
			renderLineHighlight: 'none',
			wordWrap: 'bounded',
			renderOverviewRuler: false,
			scrollbar: {
				vertical: 'hidden',
				useShadows: false
			},
			overviewRulerLanes: 0,
			scrollBeyondLastLine: false,
		};
		this._editor.updateOptions(editorOptions);

		// Auto-grow the editor as the internal content size changes (i.e. make
		// it grow vertically as the user enters additional lines of input)
		this._editor.onDidContentSizeChange((e) => {
			// Don't attempt to measure while input area is hidden
			if (this._editorHost.classList.contains('repl-editor-hidden')) {
				return;
			}

			// Measure the size of the content and host and size the editor to fit them
			const contentWidth = this._editorHost.offsetWidth;
			const contentHeight = Math.min(500, this._editor!.getContentHeight());
			this._editorHost.style.width = `${contentWidth}px`;
			this._editorHost.style.height = `${contentHeight}px`;
			this._editor!.layout({ width: contentWidth, height: contentHeight });
		});

		// Copy the editor's font settings to the output area
		const fontInfo = this._editor.getOption(EditorOption.fontInfo);
		applyFontInfo(this._output, fontInfo);

		// Lay out editor in DOM
		this._editor.layout();

		// Recompute scrolling
		this._scroller.scanDomNode();
	}

	/**
	 * Emits preformatted text to the output area.
	 *
	 * @param output The output to emit
	 */
	private emitOutput(output: string, error: boolean | undefined) {
		const pre = document.createElement('pre');
		pre.innerText = output;
		// Apply error color to errors
		if (error) {
			const errorColor = this._themeService.getColorTheme().getColor(errorForeground);
			if (errorColor) {
				pre.style.color = errorColor.toString();
			}
		}
		this._output.appendChild(pre);
		this._scroller.scanDomNode();
	}

	submit() {
		const code = this._editor?.getValue();
		if (!code) {
			throw new Error('Attempt to submit without code');
		}

		// Clear the submitted code from the editor and place it in the
		// execution region (do this after the event loop completes so that the
		// Enter keystroke that triggered this doesn't add a new line to the
		// editor)
		window.setTimeout(() => {
			// Clear the input and hide the prompt while the code is executing
			this._editorHost.classList.add('repl-editor-hidden');
			this._editor?.setValue('');

			// Append the submitted input to the output area
			this.emitOutput(`>  ${code}`, false);
		});

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
					let output = '';
					let error = false;
					if (o.mime.startsWith('text')) {
						output = o.data.toString();
					} else if (o.mime === 'application/vnd.code.notebook.error') {
						output = o.data.toString();
						error = true;
					} else {
						output = `Result type ${o.mime}`;
					}
					this.emitOutput(output, error);
				}
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
		this.scrollToBottom();
	}

	scrollToBottom() {
		this._root.scrollTop = this._root.scrollHeight;
		this._scroller.scanDomNode();
	}
}
