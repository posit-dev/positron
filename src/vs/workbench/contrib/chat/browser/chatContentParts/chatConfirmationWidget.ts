/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../base/browser/dom.js';
import { Button, ButtonWithDropdown, IButton, IButtonOptions } from '../../../../../base/browser/ui/button/button.js';
import { Action } from '../../../../../base/common/actions.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { IMarkdownString, MarkdownString } from '../../../../../base/common/htmlContent.js';
import { Disposable, MutableDisposable } from '../../../../../base/common/lifecycle.js';
import { IMarkdownRenderResult, MarkdownRenderer, openLinkFromMarkdown } from '../../../../../editor/browser/widget/markdownRenderer/browser/markdownRenderer.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { defaultButtonStyles } from '../../../../../platform/theme/browser/defaultStyles.js';
import { IHostService } from '../../../../services/host/browser/host.js';
import './media/chatConfirmationWidget.css';

export interface IChatConfirmationButton {
	label: string;
	isSecondary?: boolean;
	tooltip?: string;
	data: any;
	moreActions?: IChatConfirmationButton[];
}

export class ChatQueryTitlePart extends Disposable {
	private readonly _onDidChangeHeight = this._register(new Emitter<void>());
	public readonly onDidChangeHeight = this._onDidChangeHeight.event;
	private readonly _renderedTitle = this._register(new MutableDisposable<IMarkdownRenderResult>());

	public get title() {
		return this._title;
	}

	public set title(value: string | IMarkdownString) {
		this._title = value;

		const next = this._renderer.render(this.toMdString(value), {
			asyncRenderCallback: () => this._onDidChangeHeight.fire(),
		});

		const previousEl = this._renderedTitle.value?.element;
		if (previousEl?.parentElement) {
			previousEl.parentElement.replaceChild(next.element, previousEl);
		} else {
			this.element.appendChild(next.element); // unreachable?
		}

		this._renderedTitle.value = next;
	}

	constructor(
		private readonly element: HTMLElement,
		private _title: IMarkdownString | string,
		subtitle: string | IMarkdownString | undefined,
		private readonly _renderer: MarkdownRenderer,
		@IOpenerService private readonly _openerService: IOpenerService,
	) {
		super();

		element.classList.add('chat-query-title-part');

		this._renderedTitle.value = _renderer.render(this.toMdString(_title), {
			asyncRenderCallback: () => this._onDidChangeHeight.fire(),
		});
		element.append(this._renderedTitle.value.element);
		if (subtitle) {
			const str = this.toMdString(subtitle);
			const renderedTitle = this._register(_renderer.render(str, {
				asyncRenderCallback: () => this._onDidChangeHeight.fire(),
				actionHandler: { callback: link => openLinkFromMarkdown(this._openerService, link, str.isTrusted), disposables: this._store },
			}));
			const wrapper = document.createElement('small');
			wrapper.appendChild(renderedTitle.element);
			element.append(wrapper);
		}
	}

	private toMdString(value: string | IMarkdownString) {
		if (typeof value === 'string') {
			return new MarkdownString('', { supportThemeIcons: true }).appendText(value);
		} else {
			return new MarkdownString(value.value, { supportThemeIcons: true, isTrusted: value.isTrusted });
		}
	}
}

abstract class BaseChatConfirmationWidget extends Disposable {
	private _onDidClick = this._register(new Emitter<IChatConfirmationButton>());
	get onDidClick(): Event<IChatConfirmationButton> { return this._onDidClick.event; }

	protected _onDidChangeHeight = this._register(new Emitter<void>());
	get onDidChangeHeight(): Event<void> { return this._onDidChangeHeight.event; }

	private _domNode: HTMLElement;
	get domNode(): HTMLElement {
		return this._domNode;
	}

	setShowButtons(showButton: boolean): void {
		this.domNode.classList.toggle('hideButtons', !showButton);
	}

	private readonly messageElement: HTMLElement;
	protected readonly markdownRenderer: MarkdownRenderer;

	constructor(
		title: string,
		subtitle: string | IMarkdownString | undefined,
		buttons: IChatConfirmationButton[],
		@IInstantiationService protected readonly instantiationService: IInstantiationService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IHostService private readonly _hostService: IHostService,
	) {
		super();

		const elements = dom.h('.chat-confirmation-widget@root', [
			dom.h('.chat-confirmation-widget-title@title'),
			dom.h('.chat-confirmation-widget-message@message'),
			dom.h('.chat-confirmation-buttons-container@buttonsContainer'),
		]);
		this._domNode = elements.root;
		this.markdownRenderer = this.instantiationService.createInstance(MarkdownRenderer, {});

		const titlePart = this._register(instantiationService.createInstance(
			ChatQueryTitlePart,
			elements.title,
			title,
			subtitle,
			this.markdownRenderer,
		));

		this._register(titlePart.onDidChangeHeight(() => this._onDidChangeHeight.fire()));

		this.messageElement = elements.message;
		buttons.forEach(buttonData => {
			const buttonOptions: IButtonOptions = { ...defaultButtonStyles, secondary: buttonData.isSecondary, title: buttonData.tooltip };

			let button: IButton;
			if (buttonData.moreActions) {
				button = new ButtonWithDropdown(elements.buttonsContainer, {
					...buttonOptions,
					contextMenuProvider: contextMenuService,
					addPrimaryActionToDropdown: false,
					actions: buttonData.moreActions.map(action => this._register(new Action(
						action.label,
						action.label,
						undefined,
						true,
						() => {
							this._onDidClick.fire(action);
							return Promise.resolve();
						},
					))),
				});
			} else {
				button = new Button(elements.buttonsContainer, buttonOptions);
			}

			this._register(button);
			button.label = buttonData.label;
			this._register(button.onDidClick(() => this._onDidClick.fire(buttonData)));
		});
	}

	protected renderMessage(element: HTMLElement): void {
		this.messageElement.append(element);

		if (this._configurationService.getValue<boolean>('chat.focusWindowOnConfirmation')) {
			const targetWindow = dom.getWindow(element);
			if (!targetWindow.document.hasFocus()) {
				this._hostService.focus(targetWindow, { force: true /* Application may not be active */ });
			}
		}
	}
}

export class ChatConfirmationWidget extends BaseChatConfirmationWidget {
	constructor(
		title: string,
		subtitle: string | IMarkdownString | undefined,
		private readonly message: string | IMarkdownString,
		buttons: IChatConfirmationButton[],
		@IInstantiationService instantiationService: IInstantiationService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IHostService hostService: IHostService,
	) {
		super(title, subtitle, buttons, instantiationService, contextMenuService, configurationService, hostService);

		const renderedMessage = this._register(this.markdownRenderer.render(
			typeof this.message === 'string' ? new MarkdownString(this.message) : this.message,
			{ asyncRenderCallback: () => this._onDidChangeHeight.fire() }
		));
		this.renderMessage(renderedMessage.element);
	}
}

export class ChatCustomConfirmationWidget extends BaseChatConfirmationWidget {
	constructor(
		title: string,
		subtitle: string | IMarkdownString | undefined,
		messageElement: HTMLElement,
		buttons: IChatConfirmationButton[],
		@IInstantiationService instantiationService: IInstantiationService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IHostService hostService: IHostService,
	) {
		super(title, subtitle, buttons, instantiationService, contextMenuService, configurationService, hostService);
		this.renderMessage(messageElement);
	}
}
