/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { IHoverDelegate } from '../../../../base/browser/ui/hover/hoverDelegate.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { ResourceLabels } from '../../../browser/labels.js';
import { IChatRequestVariableEntry } from '../common/chatModel.js';
import { ILanguageModelChatMetadataAndIdentifier } from '../common/languageModels.js';
import { AbstractChatAttachmentWidget } from './chatAttachmentWidgets.js';

export class RuntimeSessionAttachmentWidget extends AbstractChatAttachmentWidget {
	constructor(
		attachment: IChatRequestVariableEntry,
		currentLanguageModel: ILanguageModelChatMetadataAndIdentifier | undefined,
		shouldFocusClearButton: boolean,
		container: HTMLElement,
		contextResourceLabels: ResourceLabels,
		hoverDelegate: IHoverDelegate,
		@ICommandService commandService: ICommandService,
		@IOpenerService openerService: IOpenerService,
	) {
		super(attachment, shouldFocusClearButton, container, contextResourceLabels, hoverDelegate, currentLanguageModel, commandService, openerService);

		// Build the label text with runtime icon if available
		const attachmentLabel = attachment.fullName ?? attachment.name;

		// Try to get the runtime metadata from the attachment
		const runtimeMetadata = (attachment as any).runtimeMetadata;
		if (runtimeMetadata?.base64EncodedIconSvg) {
			// For runtime sessions, we want to create a custom icon by embedding the SVG
			// We'll use a data URI to display the runtime icon inline
			const iconDataUri = `data:image/svg+xml;base64,${runtimeMetadata.base64EncodedIconSvg}`;

			// Set the label without icon initially
			this.label.setLabel(attachmentLabel, undefined);

			// Create and insert the runtime icon
			const iconElement = dom.$('img.runtime-session-icon', {
				src: iconDataUri,
				style: 'width: 16px; height: 16px; margin-right: 4px; vertical-align: text-bottom; display: inline-block;'
			});

			// Insert the icon at the beginning of the label container
			const labelContainer = this.label.element;
			if (labelContainer.firstChild) {
				labelContainer.insertBefore(iconElement, labelContainer.firstChild);
			} else {
				labelContainer.appendChild(iconElement);
			}
		} else {
			// Fallback to regular label if no icon
			this.label.setLabel(attachmentLabel, undefined);
		}

		this.element.ariaLabel = localize('chat.runtimeSessionAttachment', "Attached runtime session, {0}", attachment.name);

		this.attachClearButton();
	}
}
