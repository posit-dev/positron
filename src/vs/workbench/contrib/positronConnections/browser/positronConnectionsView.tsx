/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	IReactComponentContainer,
	ISize,
} from 'vs/base/browser/positronReactRenderer';
import { Emitter, Event } from 'vs/base/common/event';
import { PositronViewPane } from 'vs/workbench/browser/positronViewPane/positronViewPane';

export class PositronConnectionsView
	extends PositronViewPane
	implements IReactComponentContainer {
	private onSizeChangedEmitter = this._register(new Emitter<ISize>());
	private onVisibilityChangedEmitter = this._register(new Emitter<boolean>());
	private onSaveScrollPositionEmitter = this._register(new Emitter<void>());
	private onRestoreScrollPositionEmitter = this._register(new Emitter<void>());
	private onFocusedEmitter = this._register(new Emitter<void>());

	onFocused: Event<void> = this.onFocusedEmitter.event;
	onSizeChanged: Event<ISize> = this.onSizeChangedEmitter.event;
	onVisibilityChanged: Event<boolean> = this.onVisibilityChangedEmitter.event;
	onSaveScrollPosition: Event<void> = this.onSaveScrollPositionEmitter.event;
	onRestoreScrollPosition: Event<void> =
		this.onRestoreScrollPositionEmitter.event;

	get height() {
		return 0;
	}

	get width() {
		return 0;
	}

	get containerVisible() {
		return false;
	}

	takeFocus() { }
}
