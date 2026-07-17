/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// SPIKE (#14695): throwaway proof-of-concept EditorPane. Mirrors PositronControlGalleryEditor
// (the canonical "React inside an EditorPane" precedent) and additionally proves that a React
// tree mounted with PositronReactRenderer renders correctly when its EditorInput opts into the
// upstream modal editor part (RequiresModal). Services reach React two ways here: the pane
// resolves IPositronAssistantConfigurationService via DI and passes a snapshot as props (that
// service is NOT on the PositronReactServices accessor), while PositronReactRenderer still wraps
// the tree in the services provider so context-based services would also be available.

// Other dependencies.
import * as DOM from '../../../../../base/browser/dom.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { ProviderConfigContent } from './providerConfigContent.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { ConfigureProvidersEditorInput } from './configureProvidersEditorInput.js';
import { IPositronAssistantConfigurationService } from '../../common/interfaces/positronAssistantService.js';
import { IReactComponentContainer, ISize, IElementPosition, PositronReactRenderer } from '../../../../../base/browser/positronReactRenderer.js';

export class ConfigureProvidersEditor extends EditorPane implements IReactComponentContainer {
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
		@IPositronAssistantConfigurationService private readonly _configurationService: IPositronAssistantConfigurationService,
	) {
		super(
			ConfigureProvidersEditorInput.EditorID,
			_group,
			telemetryService,
			themeService,
			storageService
		);

		this._container = DOM.$('.positron-configure-providers-editor');
	}

	protected override createEditor(parent: HTMLElement): void {
		parent.appendChild(this._container);
	}

	override async setInput(
		input: ConfigureProvidersEditorInput,
		options: IEditorOptions | undefined,
		context: IEditorOpenContext,
		token: CancellationToken
	): Promise<void> {
		await super.setInput(input, options, context, token);

		if (!this._reactRenderer) {
			this._reactRenderer = this._register(new PositronReactRenderer(this._container));
			this._renderContent();

			// Re-render when provider registration/sign-in state changes.
			this._register(this._configurationService.onChangeProviderConfig(() => this._renderContent()));
		}

		this._onVisibilityChangedEmitter.fire(this.isVisible());
	}

	private _renderContent(): void {
		const providers = this._configurationService.getRegisteredSources().map(source => ({
			id: source.provider.id,
			displayName: source.provider.displayName,
			connected: source.signedIn === true,
		}));
		this._reactRenderer?.render(<ProviderConfigContent providers={providers} />);
	}

	override clearInput(): void {
		this._onVisibilityChangedEmitter.fire(false);
		super.clearInput();
	}

	override layout(dimension: DOM.Dimension): void {
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
