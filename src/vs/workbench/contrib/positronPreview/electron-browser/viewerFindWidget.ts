/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { IContextKey, IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IAccessibilityService } from '../../../../platform/accessibility/common/accessibility.js';
import { IBrowserViewModel } from '../../browserView/common/browserView.js';
import { SimpleFindWidget } from '../../codeEditor/browser/find/simpleFindWidget.js';

export const VIEWER_FIND_NEXT_ID = 'workbench.action.positronPreview.findNext';
export const VIEWER_FIND_PREVIOUS_ID = 'workbench.action.positronPreview.findPrevious';
export const VIEWER_HIDE_FIND_ID = 'workbench.action.positronPreview.hideFind';

/** Whether the Viewer's find widget is showing. */
export const POSITRON_VIEWER_FIND_VISIBLE = new RawContextKey<boolean>('positronViewer.findVisible', false);

/** Whether the Viewer's find widget has focus. */
export const POSITRON_VIEWER_FIND_FOCUSED = new RawContextKey<boolean>('positronViewer.findFocused', false);

/**
 * Finds text in the page the Viewer shows in the integrated browser.
 */
export class ViewerFindWidget extends SimpleFindWidget {
	private readonly _visible: IContextKey<boolean>;
	private readonly _focused: IContextKey<boolean>;
	private _result: { resultIndex: number; resultCount: number } | undefined;

	constructor(
		container: HTMLElement,
		private readonly _model: IBrowserViewModel,
		@IContextViewService contextViewService: IContextViewService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IHoverService hoverService: IHoverService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IConfigurationService configurationService: IConfigurationService,
		@IAccessibilityService accessibilityService: IAccessibilityService,
	) {
		super({
			showCommonFindToggles: true,
			checkImeCompletionState: true,
			showResultCount: true,
			initialWidth: 350,
			previousMatchActionId: VIEWER_FIND_PREVIOUS_ID,
			nextMatchActionId: VIEWER_FIND_NEXT_ID,
			closeWidgetActionId: VIEWER_HIDE_FIND_ID,
		}, contextViewService, contextKeyService, hoverService, keybindingService, configurationService, accessibilityService);
		this._visible = POSITRON_VIEWER_FIND_VISIBLE.bindTo(contextKeyService);
		this._focused = POSITRON_VIEWER_FIND_FOCUSED.bindTo(contextKeyService);
		container.appendChild(this.getDomNode());
		this._register(_model.onDidFindInPage(result => {
			this._result = { resultIndex: result.activeMatchOrdinal - 1, resultCount: result.matches };
			this.updateButtons(result.matches > 0);
			this.updateResultCount();
		}));
	}

	override reveal(initialInput?: string): void {
		const wasVisible = this.isVisible();
		super.reveal(initialInput);
		this._visible.set(true);
		this.focusFindBox();
		if (this.inputValue && !wasVisible) {
			this._onInputChanged();
		}
	}

	override hide(): void {
		super.hide(false);
		this._visible.reset();
		this._model.stopFindInPage(true);
		this._model.focus();
		this._result = undefined;
	}

	find(previous: boolean): void {
		if (this.inputValue) {
			this._model.findInPage(this.inputValue, { forward: !previous, recompute: false, matchCase: this._getCaseSensitiveValue() });
		}
	}

	findFirst(): void {
		if (this.inputValue) {
			this._model.findInPage(this.inputValue, { forward: true, recompute: true, matchCase: this._getCaseSensitiveValue() });
		}
	}

	protected _onInputChanged(): boolean {
		if (this.inputValue) {
			this.findFirst();
		} else {
			this._model.stopFindInPage(false);
			this._result = undefined;
		}
		return false;
	}

	protected async _getResultCount(): Promise<{ resultIndex: number; resultCount: number } | undefined> {
		return this._result;
	}

	protected _onFocusTrackerFocus(): void {
		this._focused.set(true);
	}

	protected _onFocusTrackerBlur(): void {
		this._focused.reset();
	}

	protected _onFindInputFocusTrackerFocus(): void { }

	protected _onFindInputFocusTrackerBlur(): void { }

	override dispose(): void {
		this._visible.reset();
		this._focused.reset();
		super.dispose();
	}
}
