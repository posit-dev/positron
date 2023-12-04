/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

//
// AUTO-GENERATED from help.json; do not edit.
//

import { Event } from 'vs/base/common/event';
import { PositronBaseComm } from 'vs/workbench/services/languageRuntime/common/positronBaseComm';
import { IRuntimeClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';

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
	kind: string;

	/**
	 * Whether to focus the Help pane when the content is displayed.
	 */
	focus: boolean;

}

export class PositronHelpComm extends PositronBaseComm {
	constructor(instance: IRuntimeClientInstance<any, any>) {
		super(instance);
		this.onDidShowHelp = super.createEventEmitter('show_help', ['content', 'kind', 'focus']);
	}

	/**
	 * Look for and, if found, show a help topic.
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

