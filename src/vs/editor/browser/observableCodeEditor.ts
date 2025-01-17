/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { equalsIfDefined, itemsEquals } from '../../base/common/equals.js';
import { Disposable, DisposableStore, IDisposable, toDisposable } from '../../base/common/lifecycle.js';
import { IObservable, ITransaction, TransactionImpl, autorun, autorunOpts, derived, derivedOpts, derivedWithSetter, observableFromEvent, observableSignal, observableValue, observableValueOpts } from '../../base/common/observable.js';
import { EditorOption, FindComputedEditorOptionValueById } from '../common/config/editorOptions.js';
import { Position } from '../common/core/position.js';
import { Selection } from '../common/core/selection.js';
import { ICursorSelectionChangedEvent } from '../common/cursorEvents.js';
import { IModelDeltaDecoration, ITextModel } from '../common/model.js';
import { IModelContentChangedEvent } from '../common/textModelEvents.js';
import { ICodeEditor, IOverlayWidget, IOverlayWidgetPosition } from './editorBrowser.js';

/**
 * Returns a facade for the code editor that provides observables for various states/events.
*/
export function observableCodeEditor(editor: ICodeEditor): ObservableCodeEditor {
	return ObservableCodeEditor.get(editor);
}

export class ObservableCodeEditor extends Disposable {
	private static readonly _map = new Map<ICodeEditor, ObservableCodeEditor>();

	/**
	 * Make sure that editor is not disposed yet!
	*/
	public static get(editor: ICodeEditor): ObservableCodeEditor {
		let result = ObservableCodeEditor._map.get(editor);
		if (!result) {
			result = new ObservableCodeEditor(editor);
			ObservableCodeEditor._map.set(editor, result);
			const d = editor.onDidDispose(() => {
				const item = ObservableCodeEditor._map.get(editor);
				if (item) {
					ObservableCodeEditor._map.delete(editor);
					item.dispose();
					d.dispose();
				}
			});
		}
		return result;
	}

	private _updateCounter = 0;
	private _currentTransaction: TransactionImpl | undefined = undefined;

	private _beginUpdate(): void {
		this._updateCounter++;
		if (this._updateCounter === 1) {
			this._currentTransaction = new TransactionImpl(() => {
				/** @description Update editor state */
			});
		}
	}

	private _endUpdate(): void {
		this._updateCounter--;
		if (this._updateCounter === 0) {
			const t = this._currentTransaction!;
			this._currentTransaction = undefined;
			t.finish();
		}
	}

	private constructor(public readonly editor: ICodeEditor) {
		super();

		this._register(this.editor.onBeginUpdate(() => this._beginUpdate()));
		this._register(this.editor.onEndUpdate(() => this._endUpdate()));

		this._register(this.editor.onDidChangeModel(() => {
			this._beginUpdate();
			try {
				this._model.set(this.editor.getModel(), this._currentTransaction);
				this._forceUpdate();
			} finally {
				this._endUpdate();
			}
		}));

		this._register(this.editor.onDidType((e) => {
			this._beginUpdate();
			try {
				this._forceUpdate();
				this.onDidType.trigger(this._currentTransaction, e);
			} finally {
				this._endUpdate();
			}
		}));

		this._register(this.editor.onDidChangeModelContent(e => {
			this._beginUpdate();
			try {
				this._versionId.set(this.editor.getModel()?.getVersionId() ?? null, this._currentTransaction, e);
				this._forceUpdate();
			} finally {
				this._endUpdate();
			}
		}));

		this._register(this.editor.onDidChangeCursorSelection(e => {
			this._beginUpdate();
			try {
				this._selections.set(this.editor.getSelections(), this._currentTransaction, e);
				this._forceUpdate();
			} finally {
				this._endUpdate();
			}
		}));
	}

	public forceUpdate(): void;
	public forceUpdate<T>(cb: (tx: ITransaction) => T): T;
	public forceUpdate<T>(cb?: (tx: ITransaction) => T): T {
		this._beginUpdate();
		try {
			this._forceUpdate();
			if (!cb) { return undefined as T; }
			return cb(this._currentTransaction!);
		} finally {
			this._endUpdate();
		}
	}

	private _forceUpdate(): void {
		this._beginUpdate();
		try {
			this._model.set(this.editor.getModel(), this._currentTransaction);
			this._versionId.set(this.editor.getModel()?.getVersionId() ?? null, this._currentTransaction, undefined);
			this._selections.set(this.editor.getSelections(), this._currentTransaction, undefined);
		} finally {
			this._endUpdate();
		}
	}

	private readonly _model = observableValue(this, this.editor.getModel());
	public readonly model: IObservable<ITextModel | null> = this._model;

	public readonly isReadonly = observableFromEvent(this, this.editor.onDidChangeConfiguration, () => this.editor.getOption(EditorOption.readOnly));

	private readonly _versionId = observableValueOpts<number | null, IModelContentChangedEvent | undefined>({ owner: this, lazy: true }, this.editor.getModel()?.getVersionId() ?? null);
	public readonly versionId: IObservable<number | null, IModelContentChangedEvent | undefined> = this._versionId;

	private readonly _selections = observableValueOpts<Selection[] | null, ICursorSelectionChangedEvent | undefined>(
		{ owner: this, equalsFn: equalsIfDefined(itemsEquals(Selection.selectionsEqual)), lazy: true },
		this.editor.getSelections() ?? null
	);
	public readonly selections: IObservable<Selection[] | null, ICursorSelectionChangedEvent | undefined> = this._selections;


	public readonly positions = derivedOpts<readonly Position[] | null>(
		{ owner: this, equalsFn: equalsIfDefined(itemsEquals(Position.equals)) },
		reader => this.selections.read(reader)?.map(s => s.getStartPosition()) ?? null
	);

	public readonly isFocused = observableFromEvent(this, e => {
		const d1 = this.editor.onDidFocusEditorWidget(e);
		const d2 = this.editor.onDidBlurEditorWidget(e);
		return {
			dispose() {
				d1.dispose();
				d2.dispose();
			}
		};
	}, () => this.editor.hasWidgetFocus());

	public readonly isTextFocused = observableFromEvent(this, e => {
		const d1 = this.editor.onDidFocusEditorText(e);
		const d2 = this.editor.onDidBlurEditorText(e);
		return {
			dispose() {
				d1.dispose();
				d2.dispose();
			}
		};
	}, () => this.editor.hasTextFocus());

	public readonly inComposition = observableFromEvent(this, e => {
		const d1 = this.editor.onDidCompositionStart(() => {
			e(undefined);
		});
		const d2 = this.editor.onDidCompositionEnd(() => {
			e(undefined);
		});
		return {
			dispose() {
				d1.dispose();
				d2.dispose();
			}
		};
	}, () => this.editor.inComposition);

	public readonly value = derivedWithSetter(this,
		reader => { this.versionId.read(reader); return this.model.read(reader)?.getValue() ?? ''; },
		(value, tx) => {
			const model = this.model.get();
			if (model !== null) {
				if (value !== model.getValue()) {
					model.setValue(value);
				}
			}
		}
	);
	public readonly valueIsEmpty = derived(this, reader => { this.versionId.read(reader); return this.editor.getModel()?.getValueLength() === 0; });
	public readonly cursorSelection = derivedOpts({ owner: this, equalsFn: equalsIfDefined(Selection.selectionsEqual) }, reader => this.selections.read(reader)?.[0] ?? null);
	public readonly cursorPosition = derivedOpts({ owner: this, equalsFn: Position.equals }, reader => this.selections.read(reader)?.[0]?.getPosition() ?? null);
	public readonly cursorLineNumber = derived<number | null>(this, reader => this.cursorPosition.read(reader)?.lineNumber ?? null);

	public readonly onDidType = observableSignal<string>(this);

	public readonly scrollTop = observableFromEvent(this.editor.onDidScrollChange, () => this.editor.getScrollTop());
	public readonly scrollLeft = observableFromEvent(this.editor.onDidScrollChange, () => this.editor.getScrollLeft());

	public readonly layoutInfo = observableFromEvent(this.editor.onDidLayoutChange, () => this.editor.getLayoutInfo());
	public readonly layoutInfoContentLeft = this.layoutInfo.map(l => l.contentLeft);
	public readonly layoutInfoDecorationsLeft = this.layoutInfo.map(l => l.decorationsLeft);

	public readonly contentWidth = observableFromEvent(this.editor.onDidContentSizeChange, () => this.editor.getContentWidth());

	public getOption<T extends EditorOption>(id: T): IObservable<FindComputedEditorOptionValueById<T>> {
		return observableFromEvent(this, cb => this.editor.onDidChangeConfiguration(e => {
			if (e.hasChanged(id)) { cb(undefined); }
		}), () => this.editor.getOption(id));
	}

	public setDecorations(decorations: IObservable<IModelDeltaDecoration[]>): IDisposable {
		const d = new DisposableStore();
		const decorationsCollection = this.editor.createDecorationsCollection();
		d.add(autorunOpts({ owner: this, debugName: () => `Apply decorations from ${decorations.debugName}` }, reader => {
			const d = decorations.read(reader);
			decorationsCollection.set(d);
		}));
		d.add({
			dispose: () => {
				decorationsCollection.clear();
			}
		});
		return d;
	}

	private _overlayWidgetCounter = 0;

	public createOverlayWidget(widget: IObservableOverlayWidget): IDisposable {
		const overlayWidgetId = 'observableOverlayWidget' + (this._overlayWidgetCounter++);
		const w: IOverlayWidget = {
			getDomNode: () => widget.domNode,
			getPosition: () => widget.position.get(),
			getId: () => overlayWidgetId,
			allowEditorOverflow: widget.allowEditorOverflow,
			getMinContentWidthInPx: () => widget.minContentWidthInPx.get(),
		};
		this.editor.addOverlayWidget(w);
		const d = autorun(reader => {
			widget.position.read(reader);
			widget.minContentWidthInPx.read(reader);
			this.editor.layoutOverlayWidget(w);
		});
		return toDisposable(() => {
			d.dispose();
			this.editor.removeOverlayWidget(w);
		});
	}
}

interface IObservableOverlayWidget {
	get domNode(): HTMLElement;
	readonly position: IObservable<IOverlayWidgetPosition | null>;
	readonly minContentWidthInPx: IObservable<number>;
	get allowEditorOverflow(): boolean;
}
