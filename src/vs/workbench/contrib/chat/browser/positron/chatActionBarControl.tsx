/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './chatActionBar.css';

import * as React from 'react'

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../../base/common/event.js';
import { PositronReactRenderer } from '../../../../../base/browser/positronReactRenderer.js';
import { ChatActionBar } from './chatActionBar.js';
import { PositronActionBarContextProvider } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { IAccessibilityService } from '../../../../../platform/accessibility/common/accessibility.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { ILayoutService } from '../../../../../platform/layout/browser/layoutService.js';
import { ILanguageModelsService, ILanguageModelChatMetadataAndIdentifier } from '../../common/languageModels.js';
import { PositronChatContextProvider } from './chatContext.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ChatInputPart } from '../chatInputPart.js';

export class ChatActionBarControl extends Disposable {
	private _container?: HTMLElement;
	private _positronReactRenderer?: PositronReactRenderer;
	private _currentLanguageModel!: ILanguageModelChatMetadataAndIdentifier;
	private readonly _onChangeLanguageModel = this._register(new Emitter<ILanguageModelChatMetadataAndIdentifier>());
	readonly onModelSelect = this._onChangeLanguageModel.event;

	constructor(
		private readonly _chatInput: ChatInputPart,
		@IAccessibilityService private readonly _accessibilityService: IAccessibilityService,
		@ICommandService private readonly _commandService: ICommandService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IContextMenuService private readonly _contextMenuService: IContextMenuService,
		@IHoverService private readonly _hoverService: IHoverService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@ILayoutService private readonly _layoutService: ILayoutService,
		@ILanguageModelsService private readonly _languageModelsService: ILanguageModelsService,
		@IModelService private readonly _modelService: IModelService,
	) {
		super();

		this._container = document.createElement('div');
		this._container.className = 'chat-action-bar-container';

		const initialModel = this._chatInput.modelPickerDelegate.getModels()
			.find((model) => model.identifier === this._chatInput.currentLanguageModel);

		if (initialModel) {
			this._currentLanguageModel = initialModel;
		}

		this._positronReactRenderer = new PositronReactRenderer(this._container);
		this._positronReactRenderer.render(
			<PositronActionBarContextProvider
				accessibilityService={this._accessibilityService}
				commandService={this._commandService}
				configurationService={this._configurationService}
				contextKeyService={this._contextKeyService}
				contextMenuService={this._contextMenuService}
				hoverService={this._hoverService}
				keybindingService={this._keybindingService}
				layoutService={this._layoutService}
			>
				<PositronChatContextProvider
					languageModelsService={this._languageModelsService}
					modelService={this._modelService}
				>
					<ChatActionBar
						currentModel={this._currentLanguageModel}
						delegate={this._chatInput.modelPickerDelegate}
						width={this._container.parentElement?.clientWidth ?? 150}
						onModelSelect={(newLanguageModel) => {
							this._currentLanguageModel = newLanguageModel;
							this._onChangeLanguageModel.fire(newLanguageModel);
						}}
					/>
				</PositronChatContextProvider>
			</PositronActionBarContextProvider>
		);
	}

	/**
	 * Renders the action bar in the given parent container.
	 * @param parent The parent container to render the action bar in.
	 */
	public render(parent: HTMLElement): void {
		if (!this._container) {
			this._container = document.createElement('div');
			this._container.className = 'chat-action-bar-container';
		}
		parent.prepend(this._container);
	}

	public get height(): number {
		return this._container?.clientHeight || 0;
	}

	override dispose(): void {
		if (this._positronReactRenderer) {
			this._positronReactRenderer.dispose();
			this._positronReactRenderer = undefined;
		}
		if (this._container) {
			this._container.remove();
			this._container = undefined;
		}

		super.dispose();
	}
}
