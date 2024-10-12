/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { ConnectionMetadata, IPositronConnectionInstance, IPositronConnectionItem } from 'vs/workbench/services/positronConnections/browser/interfaces/positronConnectionsInstance';
import { IPositronConnectionsService } from 'vs/workbench/services/positronConnections/browser/interfaces/positronConnectionsService';

export class MockedConnectionInstance implements IPositronConnectionInstance {
	private _expanded: boolean = false;

	onToggleExpandEmitter: Emitter<void> = new Emitter<void>();
	onToggleExpand: Event<void> = this.onToggleExpandEmitter.event;
	children: IPositronConnectionItem[] = [];
	metadata: ConnectionMetadata;

	constructor(
		private readonly clientId: string,
		readonly onDidChangeDataEmitter: Emitter<void>,
		readonly connectionsService: IPositronConnectionsService,
		readonly error = 'error initializing'
	) {
		this.onToggleExpand(() => {
			this._expanded = !this._expanded;
			this.onDidChangeDataEmitter.fire();
		});

		this.children = [
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

		this.metadata = {
			name: 'SQL Lite Connection 1',
			language_id: 'mock',
			type: this.clientId
		};
	}

	getClientId() {
		return this.clientId;
	}

	async getChildren() {
		if (Math.random() > 0.5) {
			throw new Error('cannot parse');
		}
		return this.children;
	}

	async hasChildren() {
		return true;
	}

	get name() {
		return 'SQL Lite Connection 1';
	}

	get kind() {
		return 'database';
	}

	get language_id() {
		return 'mock';
	}

	get id() {
		const host = (this.metadata.host !== undefined) ? this.metadata.host : 'undefined';
		const type = (this.metadata.type !== undefined) ? this.metadata.type : 'undefined';
		const language_id = this.metadata.language_id;
		return `host-${host}-type-${type}-language_id-${language_id}`;
	}

	async connect() {
		// Dummy reconnection. Just creates a new instance with the same id.
		this.connectionsService.addConnection(new MockedConnectionInstance(
			this.clientId,
			this.onDidChangeDataEmitter,
			this.connectionsService
		));
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

	async refresh() {
		this.children.pop();
		this.onDidChangeDataEmitter.fire();
	}
}

class MockedConnectionItem implements IPositronConnectionItem {

	expanded_: boolean = false;
	active: boolean = true;
	id: string = generateUniqueId();
	kind: string = 'table';

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
			new MockField('mpg', this.onDidChangeDataEmitter),
			new MockField('mpa', this.onDidChangeDataEmitter)
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
	id: string = generateUniqueId();
	kind: string = 'field';

	constructor(readonly _name: string, readonly onDidChangeDataEmitter: Emitter<void>) {

	}

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

function generateUniqueId(): string {
	return (
		Date.now().toString(36) + Math.random().toString(36).substr(2, 9)
	);
}
