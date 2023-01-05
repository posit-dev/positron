/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';

import { IKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { KeyCode } from 'vs/base/common/keyCodes';
import { Schemas } from 'vs/base/common/network';
import { Emitter, Event } from 'vs/base/common/event';
import { EditorExtensionsRegistry } from 'vs/editor/browser/editorExtensions';
import { MenuPreventer } from 'vs/workbench/contrib/codeEditor/browser/menuPreventer';
import { SelectionClipboardContributionID } from 'vs/workbench/contrib/codeEditor/browser/selectionClipboard';
import { ContextMenuController } from 'vs/editor/contrib/contextmenu/browser/contextmenu';
import { SuggestController } from 'vs/editor/contrib/suggest/browser/suggestController';
import { SnippetController2 } from 'vs/editor/contrib/snippet/browser/snippetController2';
import { TabCompletionController } from 'vs/workbench/contrib/snippets/browser/tabCompletion';
import { ModesHoverController } from 'vs/editor/contrib/hover/browser/hover';
import { MarkerController } from 'vs/editor/contrib/gotoError/browser/gotoError';
import { IEditorConstructionOptions } from 'vs/editor/browser/config/editorConfiguration';
import { CodeEditorWidget, ICodeEditorWidgetOptions } from 'vs/editor/browser/widget/codeEditorWidget';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IEditorMinimapOptions, IEditorOptions, EditorOption } from 'vs/editor/common/config/editorOptions';
import { URI } from 'vs/base/common/uri';
import { IModelService } from 'vs/editor/common/services/model';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { BareFontInfo } from 'vs/editor/common/config/fontInfo';
import { IMouseWheelEvent } from 'vs/base/browser/mouseEvent';
import { HistoryNavigator2 } from 'vs/base/common/history';

/**
 * Event fired when the input is submitted
 */
export interface IReplInputSubmitEvent {
	/** The code that the user submitted */
	code: string;

	/** Whether the input editor had focus when the code was submitted */
	focus: boolean;
}

/**
 * Event fired when the input execution is cancelled
 */
export interface IReplCancelExecutionEvent {
}

export class ReplInput extends Disposable {

	private readonly _onDidSubmitInput;
	readonly onDidSubmitInput: Event<IReplInputSubmitEvent>;
	readonly onMouseWheel: Event<IMouseWheelEvent>;

	private readonly _container: HTMLElement;

	private readonly _editor: CodeEditorWidget;

	private readonly _uri: URI;

	constructor(
		private readonly _handle: number,
		private readonly _language: string,
		private readonly _history: HistoryNavigator2<string>,
		private readonly _parentElement: HTMLElement,
		@IModelService private readonly _modelService: IModelService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILanguageService private readonly _languageService: ILanguageService
	) {
		super();

		// Set up eventing
		this._onDidSubmitInput = this._register(new Emitter<IReplInputSubmitEvent>());
		this.onDidSubmitInput = this._onDidSubmitInput.event;

		// Create editor host element
		this._container = document.createElement('div');
		this._container.classList.add('repl-editor-host');
		this._parentElement.appendChild(this._container);

		// Create editor
		const editorConstructionOptions = <IEditorConstructionOptions>{};

		const widgetOptions = <ICodeEditorWidgetOptions>{
			isSimpleWidget: false,
			contributions: EditorExtensionsRegistry.getSomeEditorContributions([
				MenuPreventer.ID,
				SelectionClipboardContributionID,
				ContextMenuController.ID,
				SuggestController.ID,
				SnippetController2.ID,
				TabCompletionController.ID,
				ModesHoverController.ID,
				MarkerController.ID,
			])
		};

		this._editor = this._instantiationService.createInstance(
			CodeEditorWidget,
			this._container,
			editorConstructionOptions,
			widgetOptions);

		this._register(this._editor);

		// Form URI for input control
		this._uri = URI.from({
			scheme: Schemas.inMemory,
			path: `/repl-${this._language}-${this._handle}`
		});

		// Create language selector
		const languageId = this._languageService.getLanguageIdByLanguageName(this._language);
		const languageSelection = this._languageService.createById(languageId);

		// Create text model; this is the backing store for the Monaco editor that receives
		// the user's input
		const textModel = this._modelService.createModel('', // initial value
			languageSelection,  // language selection
			this._uri,          // resource URI
			false               // this widget is not simple
		);

		this._editor.setModel(textModel);
		this._editor.onKeyDown((e: IKeyboardEvent) => {
			if (e.keyCode === KeyCode.Enter) {
				// If the user was holding down Shift, don't submit
				if (e.shiftKey) {
					return;
				}
				this._onDidSubmitInput.fire(<IReplInputSubmitEvent>{
					code: this._editor.getValue(),
					focus: this._editor.hasTextFocus()
				});
			} else if (e.keyCode === KeyCode.UpArrow) {
				if (this.historyNavigate(false)) {
					e.preventDefault();
					e.stopPropagation();
				}
			} else if (e.keyCode === KeyCode.DownArrow) {
				if (this.historyNavigate(true)) {
					e.preventDefault();
					e.stopPropagation();
				}
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
			handleMouseWheel: false,
			alwaysConsumeMouseWheel: false, // Note: Not currently respected in updateOptions
			lineNumbersMinChars: 3,
		};
		this._editor.updateOptions(editorOptions);

		// Auto-grow the editor as the internal content size changes (i.e. make
		// it grow vertically as the user enters additional lines of input)
		this._editor.onDidContentSizeChange((e) => {
			// Don't attempt to measure while input area is hidden
			if (this._container.classList.contains('repl-editor-hidden')) {
				return;
			}

			// Measure the size of the content and host and size the editor to fit them
			const contentWidth = this._container.offsetWidth;
			const contentHeight = Math.min(500, this._editor!.getContentHeight());
			this._container.style.width = `${contentWidth}px`;
			this._container.style.height = `${contentHeight}px`;
			this._editor!.layout({ width: contentWidth, height: contentHeight });
		});

		// Forward mouse wheel events. We do this because it is not currently
		// possible to prevent the editor from trapping scroll events, so
		// instead we use this handle to forward the scroll events to the outer
		// scrollable region (consisting of all REPL cells)
		this.onMouseWheel = this._editor.onMouseWheel;

		// Perform initial render
		this._editor.layout();
	}

	/**
	 * Drive focus to the text editor
	 */
	focus() {
		this._editor.focus();
	}

	/**
	 * Get the resource URI
	 *
	 * @returns The resource URI for the input area
	 */
	resourceUri(): URI {
		return this._uri;
	}

	/**
	 * Gets the editor's font information
	 *
	 * @returns The font info
	 */
	getFontInfo(): BareFontInfo {
		return this._editor.getOption(EditorOption.fontInfo);
	}

	/**
	 * Gets the HTML element hosting this control
	 *
	 * @returns The hosting element
	 */
	getDomNode(): HTMLElement {
		return this._container;
	}

	/**
	 * Set the read-only state of the editor. Usually used after code has been
	 * submitted to the runtime to prevent further edits.
	 *
	 * @param readOnly The new readonly state of the editor
	 */
	setReadOnly(readOnly: boolean) {
		const options: IEditorOptions = {
			readOnly: readOnly,
			domReadOnly: readOnly
		};
		this._editor.updateOptions(options);
	}

	/**
	 * Gets the focus state of the underlying editor widget
	 *
	 * @returns The focus state of the editor.
	 */
	hasFocus(): boolean {
		return this._editor.hasTextFocus();
	}

	/**
	 * Replace the input's contents with the given value, and submit it
	 * immediately for execution.
	 *
	 * @param input The input to execute.
	 */
	executeInput(input: string) {
		const focus = this.hasFocus();
		this._editor.setValue(input);
		this._onDidSubmitInput.fire({
			code: input,
			focus: focus
		});
	}

	/**
	 * Replaces the contents of the editor with the given string.
	 *
	 * @param content The new contents of the editor
	 */
	setContent(content: string) {
		this._editor.setValue(content);
	}

	/**
	 * Get the current editor contents.
	 *
	 * @returns The current content of the editor
	 */
	getContent(): string {
		return this._editor.getValue();
	}

	/**
	 * Navigate forward or back in the history.
	 *
	 * @param forward Whether to navigate forward.
	 * @returns Whether or not a navigation occurred
	 */
	historyNavigate(forward: boolean): boolean {

		// If we're at the end of the history and going back, add the current
		// value so we can go back to it (unless it is unchanged)
		if (!forward &&
			this._history.isAtEnd() &&
			this._history.current() !== this._editor.getValue()) {
			this._history.add(this._editor.getValue());
		}

		// Move cursor and get new history value
		const h = forward ?
			this._history.next() :
			this._history.previous();

		// No navigation possible (we're already at the end or beginning)
		if (!h) {
			return false;
		}

		// Load the value from the history into the editor
		this._editor.setValue(h);
		this._editor.setPosition({ lineNumber: 1, column: h.length + 1 });

		return true;
	}
}
