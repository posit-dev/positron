/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//
// AUTO-GENERATED from help.json; do not edit.
//

import { Event } from '../../../../base/common/event.js';
import { PositronBaseComm, PositronCommOptions } from './positronBaseComm.js';
import { IRuntimeClientInstance } from './languageRuntimeClientInstance.js';

/**
 * A help topic offered as an autocomplete suggestion.
 */
export interface HelpTopicSuggestion {
	/**
	 * The topic label shown to the user.
	 */
	label: string;

	/**
	 * The exact topic value used to open help.
	 */
	topic: string;

	/**
	 * Optional context such as the package containing the topic.
	 */
	detail?: string;

}

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
 * Parameters for the SearchHelp method.
 */
export interface SearchHelpParams {
	/**
	 * The help query to search for
	 */
	query: string;

	/**
	 * Opaque identifier supplied by the frontend for this UI search. Echo it
	 * in the resulting Show Help notification.
	 */
	search_id: string;
}

/**
 * Parameters for the GetHelpTopics method.
 */
export interface GetHelpTopicsParams {
	/**
	 * The text to match against help topic labels.
	 */
	query: string;

	/**
	 * Maximum number of suggestions to return, from 1 to 50.
	 */
	limit: number;
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

	/**
	 * Identifier of the UI search that requested this navigation, if any.
	 * Omit for console help and other help navigation. The frontend ignores
	 * identifiers that are no longer current.
	 */
	search_id?: string;
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

	/**
	 * Identifier of the UI search that requested this navigation, if any.
	 * Omit for console help and other help navigation. The frontend ignores
	 * identifiers that are no longer current.
	 */
	search_id?: string;

}

export enum HelpFrontendEvent {
	ShowHelp = 'show_help'
}

export enum HelpBackendRequest {
	ShowHelpTopic = 'show_help_topic',
	SearchHelp = 'search_help',
	GetHelpTopics = 'get_help_topics'
}

export class PositronHelpComm extends PositronBaseComm {
	constructor(
		instance: IRuntimeClientInstance<any, any>,
		options?: PositronCommOptions<HelpBackendRequest>,
	) {
		super(instance, options);
		this.onDidShowHelp = super.createEventEmitter('show_help', ['content', 'kind', 'focus', 'search_id']);
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
	 * Search the active interpreter's help system.
	 *
	 * Searches interpreter-wide help and displays the resulting page via a
	 * Show Help notification.
	 *
	 * @param query The help query to search for
	 * @param searchId Opaque identifier supplied by the frontend for this UI
	 * search. Echo it in the resulting Show Help notification.
	 *
	 * @returns Whether the search results navigation was requested. This
	 * does not confirm that the frontend displayed or finished loading the
	 * page.
	 */
	searchHelp(query: string, searchId: string): Promise<boolean> {
		return super.performRpc('search_help', ['query', 'search_id'], [query, searchId]);
	}

	/**
	 * Find help topics for autocomplete.
	 *
	 * Returns at most limit matching help topic suggestions, filtered and
	 * ranked by the backend. An empty query returns no suggestions.
	 *
	 * @param query The text to match against help topic labels.
	 * @param limit Maximum number of suggestions to return, from 1 to 50.
	 *
	 * @returns Help topic suggestions.
	 */
	getHelpTopics(query: string, limit: number): Promise<Array<HelpTopicSuggestion>> {
		return super.performRpc('get_help_topics', ['query', 'limit'], [query, limit]);
	}


	/**
	 * Request to show help in the frontend
	 */
	onDidShowHelp: Event<ShowHelpEvent>;
}

