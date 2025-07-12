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
import { ILanguageModelsService, IPositronChatProvider } from '../../common/languageModels.js';
import { PositronChatContextProvider } from './chatContext.js';
import { ChatInputPart } from '../chatInputPart.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';

export class ChatActionBarControl extends Disposable {
	private _container?: HTMLElement;
	private _positronReactRenderer?: PositronReactRenderer;
	private readonly _onChangeLanguageModel = this._register(new Emitter<IPositronChatProvider | undefined>());
	readonly onProviderSelected = this._onChangeLanguageModel.event;

	constructor(
		private readonly _chatInput: ChatInputPart,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILanguageModelsService private readonly _languageModelsService: ILanguageModelsService,
	) {
		super();

		this._container = document.createElement('div');
		this._container.className = 'chat-action-bar-container';

		this._positronReactRenderer = this._register(this._instantiationService.createInstance(PositronReactRenderer, this._container));
		this._positronReactRenderer.render(
			<PositronActionBarContextProvider>
				<PositronChatContextProvider
					chatInput={this._chatInput}
					languageModelsService={this._languageModelsService}
				>
					<ChatActionBar
						width={this._container.parentElement?.clientWidth ?? 150}
						onModelSelect={(newLanguageModel) => {
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
		super.dispose();
		if (this._container) {
			this._container.remove();
			this._container = undefined;
		}
	}
}
