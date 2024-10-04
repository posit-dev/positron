/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { IPositronConnectionInstance, IPositronConnectionItem } from 'vs/workbench/services/positronConnections/browser/interfaces/positronConnectionsInstance';

export class MockedConnectionInstance implements IPositronConnectionInstance {
	private _expanded: boolean = false;
	onToggleExpandEmitter: Emitter<void> = new Emitter<void>();
	onToggleExpand: Event<void> = this.onToggleExpandEmitter.event;

	children = [
		new MockedConnectionItem(),
		new MockedConnectionItem(),
		new MockedConnectionItem(),
	];

	constructor(private readonly clientId: string) {
		this.onToggleExpand(() => {
			console.log('Expand clicked!');
			this._expanded = !this._expanded;
		});
	}

	getClientId() {
		return this.clientId;
	}

	getChildren() {
		return this.children;
	}

	hasChildren() {
		return true;
	}

	name() {
		return 'SQL Lite Connection 1';
	}

	icon() {
		return 'database';
	}

	expanded() {
		return this._expanded;
	}
}

class MockedConnectionItem implements IPositronConnectionItem {

	expanded_: boolean = false;
	onToggleExpandEmitter: Emitter<void> = new Emitter<void>();
	onToggleExpand: Event<void> = this.onToggleExpandEmitter.event;

	constructor() {
		this.onToggleExpand(() => {
			this.expanded_ = !this.expanded_;
		});
	}

	name() {
		return 'children 1';
	}

	getChildren() {
		return [];
	}

	hasChildren(): boolean {
		return false;
	}

	icon() {
		return 'database';
	}

	expanded() {
		return false;
	}
}

