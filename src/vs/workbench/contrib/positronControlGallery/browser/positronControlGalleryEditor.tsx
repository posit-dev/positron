/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronControlGalleryEditor.css';

// Other dependencies.
import * as DOM from '../../../../base/browser/dom.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { ControlGallery } from './components/controlGallery.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { PositronControlGalleryEditorInput } from './positronControlGalleryEditorInput.js';
import { IReactComponentContainer, ISize, IElementPosition, PositronReactRenderer } from '../../../../base/browser/positronReactRenderer.js';

/**
 * Editor pane that hosts the Positron Control Gallery React tree. A developer-only environment
 * for iterating on Positron controls (Positron List, Positron Tree, etc.) with configurable
 * fixtures. Implements IReactComponentContainer so individual harnesses can subscribe to size
 * and visibility events if they need them.
 */
export class PositronControlGalleryEditor extends EditorPane implements IReactComponentContainer {
	private readonly _container: HTMLElement;
	private _reactRenderer?: PositronReactRenderer;

	private _width = 0;
	private _height = 0;

	private readonly _onSizeChangedEmitter = this._register(new Emitter<ISize>());
	private readonly _onPositionChangedEmitter = this._register(new Emitter<IElementPosition>());
	private readonly _onVisibilityChangedEmitter = this._register(new Emitter<boolean>());
	private readonly _onSaveScrollPositionEmitter = this._register(new Emitter<void>());
	private readonly _onRestoreScrollPositionEmitter = this._register(new Emitter<void>());
	private readonly _onFocusedEmitter = this._register(new Emitter<void>());

	get width() { return this._width; }
	get height() { return this._height; }
	get containerVisible() { return this.isVisible(); }
	takeFocus(): void { this.focus(); }

	readonly onSizeChanged = this._onSizeChangedEmitter.event;
	readonly onPositionChanged = this._onPositionChangedEmitter.event;
	readonly onVisibilityChanged: Event<boolean> = this._onVisibilityChangedEmitter.event;
	readonly onSaveScrollPosition: Event<void> = this._onSaveScrollPositionEmitter.event;
	readonly onRestoreScrollPosition: Event<void> = this._onRestoreScrollPositionEmitter.event;
	readonly onFocused: Event<void> = this._onFocusedEmitter.event;

	constructor(
		readonly _group: IEditorGroup,
		@IStorageService storageService: IStorageService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
	) {
		super(
			PositronControlGalleryEditorInput.EditorID,
			_group,
			telemetryService,
			themeService,
			storageService
		);

		this._container = DOM.$('.positron-control-gallery-editor');
	}

	protected override createEditor(parent: HTMLElement): void {
		parent.appendChild(this._container);
	}

	override async setInput(
		input: PositronControlGalleryEditorInput,
		options: IEditorOptions | undefined,
		context: IEditorOpenContext,
		token: CancellationToken
	): Promise<void> {
		await super.setInput(input, options, context, token);

		if (!this._reactRenderer) {
			this._reactRenderer = this._register(new PositronReactRenderer(this._container));
			this._reactRenderer.render(<ControlGallery />);
		}

		this._onVisibilityChangedEmitter.fire(this.isVisible());
	}

	override clearInput(): void {
		this._onVisibilityChangedEmitter.fire(false);
		super.clearInput();
	}

	override layout(dimension: DOM.Dimension): void {
		// Size the container explicitly to the framework's dimension rather than relying on
		// CSS percentage sizing -- this is the convention other Positron editors follow (see
		// PositronPreviewEditor.layout). Note: the editor group still paints a 1 CSS pixel
		// bottom chrome over the bottom of the content area, so embedded controls lose ~1px
		// at the bottom edge regardless of how the container is sized.
		DOM.size(this._container, dimension.width, dimension.height);

		this._width = dimension.width;
		this._height = dimension.height;

		this._onSizeChangedEmitter.fire({ width: dimension.width, height: dimension.height });

		const bounding = this._container.getBoundingClientRect();
		this._onPositionChangedEmitter.fire({ x: bounding.x, y: bounding.y });
	}

	override focus(): void {
		super.focus();
		this._onFocusedEmitter.fire();
	}
}
