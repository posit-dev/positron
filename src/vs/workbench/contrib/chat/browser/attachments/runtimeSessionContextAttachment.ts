/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../base/browser/dom.js';
import { Button } from '../../../../../base/browser/ui/button/button.js';
import { getDefaultHoverDelegate } from '../../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { ResourceLabels } from '../../../../browser/labels.js';
import { ChatRuntimeSessionContext } from '../widget/input/editor/chatRuntimeSessionContext.js';

/**
 * Widget to display the implicit runtime session context attachment in the chat
 * attachments.
 *
 * This renders the session context attachment with the session name, icon, and
 * a toggle button to enable/disable the attachment.
 */
export class RuntimeSessionContextAttachmentWidget extends Disposable {
	public readonly domNode: HTMLElement;

	private readonly renderDisposables = this._register(new DisposableStore());

	constructor(
		private readonly attachment: ChatRuntimeSessionContext,
		private readonly resourceLabels: ResourceLabels,
		@IHoverService private readonly hoverService: IHoverService,
	) {
		super();

		this.domNode = dom.$('.chat-attached-context-attachment.show-file-icons.implicit');
		this.render();
	}

	private render() {
		dom.clearNode(this.domNode);
		this.renderDisposables.clear();

		this.domNode.classList.toggle('disabled', !this.attachment.enabled);
		this.domNode.classList.add('runtime-session-context-attachment');
		const label = this.resourceLabels.create(this.domNode, { supportIcons: true });

		const ariaLabel = localize('chat.runtimeSessionAttachment', "Attached runtime session");

		const currentFile = localize('sessionContext', "Current runtime session context");
		const inactive = localize('enableHint', "disabled");
		const currentFileHint = currentFile + (this.attachment.enabled ? '' : ` (${inactive})`);
		const title = `${currentFileHint}`;

		// Create icon URI from base64 encoded SVG if available
		let iconPath: URI | undefined;
		if (this.attachment.value?.runtimeMetadata.base64EncodedIconSvg) {
			iconPath = URI.parse(`data:image/svg+xml;base64,${this.attachment.value.runtimeMetadata.base64EncodedIconSvg}`);
		}

		label.setLabel(this.attachment.name, undefined, {
			title,
			iconPath,
		});
		this.domNode.ariaLabel = ariaLabel;
		this.domNode.tabIndex = 0;

		const consoleSessionLabel = localize('hint.label.console', "Console session");
		const notebookSessionLabel = localize('hint.label.notebook', "Notebook session");
		const hintElement = dom.append(this.domNode, dom.$('span.chat-implicit-hint', undefined,
			this.attachment.value?.metadata.sessionMode === 'notebook' ? notebookSessionLabel : consoleSessionLabel
		));
		this._register(this.hoverService.setupManagedHover(getDefaultHoverDelegate('element'), hintElement, title));

		const buttonMsg = this.attachment.enabled ? localize('disable', "Disable current session context") : localize('enable', "Enable current session context");
		const toggleButton = this.renderDisposables.add(new Button(this.domNode, { supportIcons: true, title: buttonMsg }));
		toggleButton.icon = this.attachment.enabled ? Codicon.eye : Codicon.eyeClosed;
		this.renderDisposables.add(toggleButton.onDidClick((e) => {
			e.stopPropagation(); // prevent it from triggering the click handler on the parent immediately after rerendering
			this.attachment.enabled = !this.attachment.enabled;
		}));
	}
}
