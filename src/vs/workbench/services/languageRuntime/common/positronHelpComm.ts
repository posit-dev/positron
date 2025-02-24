/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//
// AUTO-GENERATED from help.json; do not edit.
//

import { Event } from '../../../../base/common/event.js';
import { PositronBaseComm, PositronCommOptions } from './positronBaseComm.js';
import { IRuntimeClientInstance } from './languageRuntimeClientInstance.js';

/**
 * Parameters for the ShowHelpTopic method.
 */
export interface ShowHelpTopicParams {
	/**
	 * The help topic to show
	 */
	topic: string;
}

/**
 * Possible values for Kind in ShowHelp
 */
export enum ShowHelpKind {
	Html = 'html',
	Markdown = 'markdown',
	Url = 'url'
}

/**
 * Parameters for the ShowHelp method.
 */
export interface ShowHelpParams {
	/**
	 * The help content to show
	 */
	content: string;

	/**
	 * The type of content to show
	 */
	kind: ShowHelpKind;

	/**
	 * Whether to focus the Help pane when the content is displayed.
	 */
	focus: boolean;
}

/**
 * Event: Request to show help in the frontend
 */
export interface ShowHelpEvent {
	/**
	 * The help content to show
	 */
	content: string;

	/**
	 * The type of content to show
	 */
	kind: ShowHelpKind;

	/**
	 * Whether to focus the Help pane when the content is displayed.
	 */
	focus: boolean;

}

export enum HelpFrontendEvent {
	ShowHelp = 'show_help'
}

export enum HelpBackendRequest {
	ShowHelpTopic = 'show_help_topic'
}

export class PositronHelpComm extends PositronBaseComm {
	constructor(
		instance: IRuntimeClientInstance<any, any>,
		options?: PositronCommOptions<HelpBackendRequest>,
	) {
		super(instance, options);
		this.onDidShowHelp = super.createEventEmitter('show_help', ['content', 'kind', 'focus']);
	}

	/**
	 * Look for and, if found, show a help topic.
	 *
	 * Requests that the help backend look for a help topic and, if found,
	 * show it. If the topic is found, it will be shown via a Show Help
	 * notification. If the topic is not found, no notification will be
	 * delivered.
	 *
	 * @param topic The help topic to show
	 *
	 * @returns Whether the topic was found and shown. Topics are shown via a
	 * Show Help notification.
	 */
	showHelpTopic(topic: string): Promise<boolean> {
		return super.performRpc('show_help_topic', ['topic'], [topic]);
	}


	/**
	 * Request to show help in the frontend
	 */
	onDidShowHelp: Event<ShowHelpEvent>;
}

