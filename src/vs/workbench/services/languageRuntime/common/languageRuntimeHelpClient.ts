/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Event } from '../../../../base/common/event.js';
import { IRuntimeClientInstance } from './languageRuntimeClientInstance.js';
import { HelpTopicSuggestion, PositronHelpComm, ShowHelpEvent } from './positronHelpComm.js';

/**
 * How long to wait for help search results and topic suggestions from the interpreter.
 */
export const HELP_SEARCH_TIMEOUT_MS = 30_000;

/**
 * A help client instance.
 */
export class HelpClientInstance extends Disposable {

	/** The underlying comm. */
	private readonly _comm: PositronHelpComm;

	/**
	 * Creates a new help client instance.
	 *
	 * @param _client The client instance. Takes ownership of the client
	 *   instance and will dispose it when it is disposed.
	 */
	constructor(
		client: IRuntimeClientInstance<any, any>,
		readonly languageId: string
	) {
		super();
		this._comm = new PositronHelpComm(client, {
			// The Help service times out the search together with the page it shows.
			search_help: { timeout: undefined },
			get_help_topics: { timeout: HELP_SEARCH_TIMEOUT_MS },
		});
		this._register(this._comm);

		this.onDidEmitHelpContent = this._comm.onDidShowHelp;
		this.onDidClose = this._comm.onDidClose;
	}

	/**
	 * Requests that the given help topic be shown in the Help pane. If the
	 * topic was found, a 'show_help' event will be emitted.
	 *
	 * @param topic The topic to show in the Help pane.
	 * @returns A promise that resolves to 'true' if the topic was found, and
	 *   'false' otherwise.
	 */
	async showHelpTopic(topic: string, packageName?: string): Promise<boolean> {
		return this._comm.showHelpTopic(topic, packageName);
	}

	/**
	 * Searches the interpreter's help and shows the results page.
	 * @param query The search query.
	 * @param searchId Identifies the search. The interpreter tags the results page with it.
	 * @returns Whether the interpreter will show a results page.
	 */
	searchHelp(query: string, searchId: string): Promise<boolean> {
		return this._comm.searchHelp(query, searchId);
	}

	/**
	 * Gets help topics that match a query, for autocomplete.
	 * @param query The text to match.
	 * @param limit The maximum number of topics, from 1 to 50.
	 * @returns The matching topics, best matches first.
	 */
	getHelpTopics(query: string, limit: number): Promise<HelpTopicSuggestion[]> {
		return this._comm.getHelpTopics(query, limit);
	}

	onDidEmitHelpContent: Event<ShowHelpEvent>;

	onDidClose: Event<void>;
}
