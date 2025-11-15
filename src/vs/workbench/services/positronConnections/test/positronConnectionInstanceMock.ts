/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../base/common/event.js';
import { IPositronConnectionInstance, IPositronConnectionsEntriesChangedEvent } from '../common/interfaces/positronConnectionsInstance.js';

export class TestConnectionInstance extends Disposable implements IPositronConnectionInstance {
	id: string;
	active: boolean = false;
	metadata: any; // Replace with actual type if available

	constructor(id: string) {
		super();
		this.id = id;
	}

	connectFired = 1;
	connect(): Promise<void> {
		this.connectFired++;
		return Promise.resolve();
	}

	disconnectFired = 0;
	disconnect(): Promise<void> {
		this.disconnectFired++;
		return Promise.resolve();
	}

	refreshFired = 0;
	refresh(): Promise<void> {
		this.refreshFired++;
		return Promise.resolve();
	}

	onDidChangeEntriesEmitter = new Emitter<IPositronConnectionsEntriesChangedEvent>();
	onDidChangeStatusEmitter = new Emitter<boolean>();

	onDidChangeEntries = this.onDidChangeEntriesEmitter.event;
	onDidChangeStatus = this.onDidChangeStatusEmitter.event;

	refreshEntries(): Promise<void> {
		return Promise.resolve();
	}

	getEntries(): any[] {
		return [];
	}

	onToggleExpandEmitter = new Emitter<string>();
}
