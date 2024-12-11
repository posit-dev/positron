/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Event } from '../../../../base/common/event.js';
import { IRuntimeClientInstance } from './languageRuntimeClientInstance.js';
import { PositronHelpComm, ShowHelpEvent } from './positronHelpComm.js';

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
		this._comm = new PositronHelpComm(client);
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
	async showHelpTopic(topic: string): Promise<boolean> {
		return this._comm.showHelpTopic(topic);
	}

	onDidEmitHelpContent: Event<ShowHelpEvent>;

	onDidClose: Event<void>;
}
