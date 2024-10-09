/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { IPositronConnectionInstance, IPositronConnectionItem } from 'vs/workbench/services/positronConnections/browser/interfaces/positronConnectionsInstance';
import { IPositronConnectionsService } from 'vs/workbench/services/positronConnections/browser/interfaces/positronConnectionsService';

export class MockedConnectionInstance implements IPositronConnectionInstance {
	private _expanded: boolean = false;

	onToggleExpandEmitter: Emitter<void> = new Emitter<void>();
	onToggleExpand: Event<void> = this.onToggleExpandEmitter.event;

	children = [
		new MockedConnectionItem(this.onDidChangeDataEmitter),
		new MockedConnectionItem(this.onDidChangeDataEmitter),
		new MockedConnectionItem(this.onDidChangeDataEmitter),
		new MockedConnectionItem(this.onDidChangeDataEmitter),
		new MockedConnectionItem(this.onDidChangeDataEmitter),
		new MockedConnectionItem(this.onDidChangeDataEmitter),
		new MockedConnectionItem(this.onDidChangeDataEmitter),
		new MockedConnectionItem(this.onDidChangeDataEmitter),
		new MockedConnectionItem(this.onDidChangeDataEmitter),
		new MockedConnectionItem(this.onDidChangeDataEmitter),
		new MockedConnectionItem(this.onDidChangeDataEmitter),
		new MockedConnectionItem(this.onDidChangeDataEmitter),
		new MockedConnectionItem(this.onDidChangeDataEmitter),
		new MockedConnectionItem(this.onDidChangeDataEmitter),
		new MockedConnectionItem(this.onDidChangeDataEmitter),
		new MockedConnectionItem(this.onDidChangeDataEmitter),
		new MockedConnectionItem(this.onDidChangeDataEmitter),
		new MockedConnectionItem(this.onDidChangeDataEmitter),
		new MockedConnectionItem(this.onDidChangeDataEmitter),
		new MockedConnectionItem(this.onDidChangeDataEmitter),
		new MockedConnectionItem(this.onDidChangeDataEmitter),
		new MockedConnectionItem(this.onDidChangeDataEmitter),
		new MockedConnectionItem(this.onDidChangeDataEmitter),
		new MockedConnectionItem(this.onDidChangeDataEmitter),
		new MockedConnectionItem(this.onDidChangeDataEmitter),
		new MockedConnectionItem(this.onDidChangeDataEmitter),
		new MockedConnectionItem(this.onDidChangeDataEmitter),
		new MockedConnectionItem(this.onDidChangeDataEmitter),
		new MockedConnectionItem(this.onDidChangeDataEmitter),
	];

	constructor(
		private readonly clientId: string,
		readonly onDidChangeDataEmitter: Emitter<void>,
		readonly connectionsService: IPositronConnectionsService,
	) {
		this.onToggleExpand(() => {
			this._expanded = !this._expanded;
			this.onDidChangeDataEmitter.fire();
		});
	}

	getClientId() {
		return this.clientId;
	}

	async getChildren() {
		return this.children;
	}

	async hasChildren() {
		return true;
	}

	get name() {
		return 'SQL Lite Connection 1';
	}

	get id() {
		return this.clientId;
	}

	async connect() {
		// Dummy reconnection. Just creates a new instance with the same id.
		this.connectionsService.addConnection(new MockedConnectionInstance(
			this.clientId,
			this.onDidChangeDataEmitter,
			this.connectionsService
		));
	}

	async getIcon() {
		return 'database';
	}

	get expanded() {
		return this._expanded;
	}

	_active: boolean = true;

	get active() {
		return this._active;
	}

	async disconnect() {
		this._active = false;
		this._expanded = false;
		this.onDidChangeDataEmitter.fire();
	}
}

class MockedConnectionItem implements IPositronConnectionItem {

	expanded_: boolean = false;
	active: boolean = true;

	onToggleExpandEmitter: Emitter<void> = new Emitter<void>();
	onToggleExpand: Event<void> = this.onToggleExpandEmitter.event;

	constructor(readonly onDidChangeDataEmitter: Emitter<void>) {
		this.onToggleExpand(() => {
			this.expanded_ = !this.expanded_;
			this.onDidChangeDataEmitter.fire();
		});
	}

	get name() {
		return 'children 1';
	}

	async getChildren() {
		return [
			new MockField('mpg'),
			new MockField('mpa')
		];
	}

	async getIcon() {
		return 'database';
	}

	async hasChildren() {
		return true;
	}

	get expanded() {
		return this.expanded_;
	}
}

class MockField implements IPositronConnectionItem {

	active: boolean = true;

	constructor(readonly _name: string) { }

	get name() {
		return this._name;
	}

	async getIcon() {
		return 'database';
	}

	get expanded() {
		return undefined;
	}

	async hasChildren() {
		return false;
	}

	async getChildren() {
		return [];
	}
}
