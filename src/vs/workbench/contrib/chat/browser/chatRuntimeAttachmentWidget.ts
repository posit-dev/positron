/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { ResourceLabels } from '../../../browser/labels.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { IChatRequestVariableEntry } from '../common/chatVariableEntries.js';
import { ILanguageModelChatMetadataAndIdentifier } from '../common/languageModels.js';
import { AbstractChatAttachmentWidget } from './chatAttachmentWidgets.js';

/**
 * Helper function to get the icon for a runtime session.
 *
 * @param sessionId The session ID of the runtime session.
 * @param runtimeSessionService The runtime session service to retrieve the session metadata.
 *
 * @returns The base64 encoded SVG icon string if available, otherwise an empty string.
 */
function getIconForSession(
	sessionId: string,
	runtimeSessionService: IRuntimeSessionService,
): string {
	const session = runtimeSessionService.getSession(sessionId);
	if (!session) {
		return '';
	}

	const runtimeMetadata = session.runtimeMetadata;
	if (!runtimeMetadata) {
		return '';
	}

	if (runtimeMetadata?.base64EncodedIconSvg) {
		return runtimeMetadata.base64EncodedIconSvg;
	}

	return '';
}

export class RuntimeSessionAttachmentWidget extends AbstractChatAttachmentWidget {
	constructor(
		attachment: IChatRequestVariableEntry,
		currentLanguageModel: ILanguageModelChatMetadataAndIdentifier | undefined,
		options: { shouldFocusClearButton: boolean; supportsDeletion: boolean },
		container: HTMLElement,
		contextResourceLabels: ResourceLabels,
		@ICommandService commandService: ICommandService,
		@IOpenerService openerService: IOpenerService,
		@IRuntimeSessionService runtimeSessionService: IRuntimeSessionService,
	) {
		super(attachment, options, container, contextResourceLabels, currentLanguageModel, commandService, openerService);

		// Build the label text with runtime icon if available
		const attachmentLabel = attachment.fullName ?? attachment.name;

		const activeSession = (attachment as any).value?.activeSession;
		const sessionId = activeSession.identifier;
		const iconSvg = getIconForSession(sessionId, runtimeSessionService);

		if (iconSvg) {
			// For runtime sessions, we want to create a custom icon by embedding the SVG
			// We'll use a data URI to display the runtime icon inline
			const iconDataUri = `data:image/svg+xml;base64,${iconSvg}`;

			// Set the label without icon initially
			this.label.setLabel(attachmentLabel, undefined);

			// Create and insert the runtime icon
			const iconElement = dom.$('img.runtime-session-icon', {
				src: iconDataUri,
				style: 'width: 14px; height: 14px; margin-right: 3px; margin-left: 1px; margin-top: 2px; vertical-align: text-bottom; display: inline-block;'
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
