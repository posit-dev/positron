/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { KeyCode } from 'vs/base/common/keyCodes';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { ICodeEditor, IEditorMouseEvent, IPartialEditorMouseEvent } from 'vs/editor/browser/editorBrowser';
import { ConfigurationChangedEvent, EditorOption } from 'vs/editor/common/config/editorOptions';
import { IEditorContribution, IScrollEvent } from 'vs/editor/common/editorCommon';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IHoverWidget } from 'vs/editor/contrib/hover/browser/hoverTypes';
import { RunOnceScheduler } from 'vs/base/common/async';
import { isMousePositionWithinElement } from 'vs/editor/contrib/hover/browser/hoverUtils';
import 'vs/css!./hover';
import { MarginHoverWidget } from 'vs/editor/contrib/hover/browser/marginHoverWidget';

// sticky hover widget which doesn't disappear on focus out and such
const _sticky = false
	// || Boolean("true") // done "weirdly" so that a lint warning prevents you from pushing this
	;

interface IHoverSettings {
	readonly enabled: boolean;
	readonly sticky: boolean;
	readonly hidingDelay: number;
}

interface IHoverState {
	mouseDown: boolean;
}

export class MarginHoverController extends Disposable implements IEditorContribution {

	public static readonly ID = 'editor.contrib.marginHover';

	public shouldKeepOpenOnEditorMouseMoveOrLeave: boolean = false;

	private readonly _listenersStore = new DisposableStore();

	private _glyphWidget: MarginHoverWidget | undefined;
	private _mouseMoveEvent: IEditorMouseEvent | undefined;
	private _reactToEditorMouseMoveRunner: RunOnceScheduler;

	private _hoverSettings!: IHoverSettings;
	private _hoverState: IHoverState = {
		mouseDown: false
	};

	constructor(
		private readonly _editor: ICodeEditor,
		@IInstantiationService private readonly _instantiationService: IInstantiationService
	) {
		super();
		this._reactToEditorMouseMoveRunner = this._register(
			new RunOnceScheduler(
				() => this._reactToEditorMouseMove(this._mouseMoveEvent), 0
			)
		);
		this._hookListeners();
		this._register(this._editor.onDidChangeConfiguration((e: ConfigurationChangedEvent) => {
			if (e.hasChanged(EditorOption.hover)) {
				this._unhookListeners();
				this._hookListeners();
			}
		}));
	}

	static get(editor: ICodeEditor): MarginHoverController | null {
		return editor.getContribution<MarginHoverController>(MarginHoverController.ID);
	}

	private _hookListeners(): void {

		const hoverOpts = this._editor.getOption(EditorOption.hover);
		this._hoverSettings = {
			enabled: hoverOpts.enabled,
			sticky: hoverOpts.sticky,
			hidingDelay: hoverOpts.hidingDelay
		};

		if (hoverOpts.enabled) {
			this._listenersStore.add(this._editor.onMouseDown((e: IEditorMouseEvent) => this._onEditorMouseDown(e)));
			this._listenersStore.add(this._editor.onMouseUp(() => this._onEditorMouseUp()));
			this._listenersStore.add(this._editor.onMouseMove((e: IEditorMouseEvent) => this._onEditorMouseMove(e)));
			this._listenersStore.add(this._editor.onKeyDown((e: IKeyboardEvent) => this._onKeyDown(e)));
		} else {
			this._listenersStore.add(this._editor.onMouseMove((e: IEditorMouseEvent) => this._onEditorMouseMove(e)));
			this._listenersStore.add(this._editor.onKeyDown((e: IKeyboardEvent) => this._onKeyDown(e)));
		}

		this._listenersStore.add(this._editor.onMouseLeave((e) => this._onEditorMouseLeave(e)));
		this._listenersStore.add(this._editor.onDidChangeModel(() => {
			this._cancelScheduler();
			this._hideWidgets();
		}));
		this._listenersStore.add(this._editor.onDidChangeModelContent(() => this._cancelScheduler()));
		this._listenersStore.add(this._editor.onDidScrollChange((e: IScrollEvent) => this._onEditorScrollChanged(e)));
	}

	private _unhookListeners(): void {
		this._listenersStore.clear();
	}

	private _cancelScheduler() {
		this._mouseMoveEvent = undefined;
		this._reactToEditorMouseMoveRunner.cancel();
	}

	private _onEditorScrollChanged(e: IScrollEvent): void {
		if (e.scrollTopChanged || e.scrollLeftChanged) {
			this._hideWidgets();
		}
	}

	private _onEditorMouseDown(mouseEvent: IEditorMouseEvent): void {
		this._hoverState.mouseDown = true;
		const shouldNotHideCurrentHoverWidget = this._isMouseOnMarginHoverWidget(mouseEvent);
		if (shouldNotHideCurrentHoverWidget) {
			return;
		}
		this._hideWidgets();
	}

	private _isMouseOnMarginHoverWidget(mouseEvent: IPartialEditorMouseEvent): boolean {
		const marginHoverWidgetNode = this._glyphWidget?.getDomNode();
		if (marginHoverWidgetNode) {
			return isMousePositionWithinElement(marginHoverWidgetNode, mouseEvent.event.posx, mouseEvent.event.posy);
		}
		return false;
	}

	private _onEditorMouseUp(): void {
		this._hoverState.mouseDown = false;
	}

	private _onEditorMouseLeave(mouseEvent: IPartialEditorMouseEvent): void {
		if (this.shouldKeepOpenOnEditorMouseMoveOrLeave) {
			return;
		}

		this._cancelScheduler();
		const shouldNotHideCurrentHoverWidget = this._isMouseOnMarginHoverWidget(mouseEvent);
		if (shouldNotHideCurrentHoverWidget) {
			return;
		}
		if (_sticky) {
			return;
		}
		this._hideWidgets();
	}

	private _shouldNotRecomputeCurrentHoverWidget(mouseEvent: IEditorMouseEvent): boolean {
		const isHoverSticky = this._hoverSettings.sticky;
		const isMouseOnMarginHoverWidget = this._isMouseOnMarginHoverWidget(mouseEvent);
		return isHoverSticky && isMouseOnMarginHoverWidget;
	}

	private _onEditorMouseMove(mouseEvent: IEditorMouseEvent): void {
		if (this.shouldKeepOpenOnEditorMouseMoveOrLeave) {
			return;
		}

		this._mouseMoveEvent = mouseEvent;
		const shouldNotRecomputeCurrentHoverWidget = this._shouldNotRecomputeCurrentHoverWidget(mouseEvent);
		if (shouldNotRecomputeCurrentHoverWidget) {
			this._reactToEditorMouseMoveRunner.cancel();
			return;
		}
		this._reactToEditorMouseMove(mouseEvent);
	}

	private _reactToEditorMouseMove(mouseEvent: IEditorMouseEvent | undefined): void {

		if (!mouseEvent) {
			return;
		}
		const glyphWidgetShowsOrWillShow = this._tryShowHoverWidget(mouseEvent);
		if (glyphWidgetShowsOrWillShow) {
			return;
		}
		if (_sticky) {
			return;
		}
		this._hideWidgets();
	}

	private _tryShowHoverWidget(mouseEvent: IEditorMouseEvent): boolean {
		const glyphWidget: IHoverWidget = this._getOrCreateGlyphWidget();
		return glyphWidget.showsOrWillShow(mouseEvent);
	}

	private _onKeyDown(e: IKeyboardEvent): void {
		if (!this._editor.hasModel()) {
			return;
		}
		if (e.keyCode === KeyCode.Ctrl
			|| e.keyCode === KeyCode.Alt
			|| e.keyCode === KeyCode.Meta
			|| e.keyCode === KeyCode.Shift) {
			// Do not hide hover when a modifier key is pressed
			return;
		}
		this._hideWidgets();
	}

	private _hideWidgets(): void {
		if (_sticky) {
			return;
		}
		this._glyphWidget?.hide();
	}

	private _getOrCreateGlyphWidget(): MarginHoverWidget {
		if (!this._glyphWidget) {
			this._glyphWidget = this._instantiationService.createInstance(MarginHoverWidget, this._editor);
		}
		return this._glyphWidget;
	}

	public hideContentHover(): void {
		this._hideWidgets();
	}

	public override dispose(): void {
		super.dispose();
		this._unhookListeners();
		this._listenersStore.dispose();
		this._glyphWidget?.dispose();
	}
}
