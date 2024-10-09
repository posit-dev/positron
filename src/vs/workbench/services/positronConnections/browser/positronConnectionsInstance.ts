/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ConnectionsClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeConnectionsClient';
import { IPositronConnectionInstance, IPositronConnectionItem } from 'vs/workbench/services/positronConnections/browser/interfaces/positronConnectionsInstance';
import { ObjectSchema } from 'vs/workbench/services/languageRuntime/common/positronConnectionsComm';

interface PathSchema extends ObjectSchema {
	dtype?: string;
}

export class PositronConnectionsInstance extends Disposable implements IPositronConnectionInstance {

	onToggleExpandEmitter: Emitter<void> = new Emitter<void>();
	onToggleExpand: Event<void> = this.onToggleExpandEmitter.event;

	_expanded: boolean = false;
	_active: boolean = true;
	_children: IPositronConnectionItem[] | undefined;

	constructor(
		readonly onDidChangeDataEmitter: Emitter<void>,
		private readonly client: ConnectionsClientInstance,
		private readonly metadata: ConnectionMetadata
	) {
		super();

		this._register(this.onToggleExpand(() => {
			this._expanded = !this._expanded;
			this.onDidChangeDataEmitter.fire();
		}));

		this._register(this.client.onDidClose(() => {
			this._active = false;
			this._expanded = false;
			this.onDidChangeDataEmitter.fire();
		}));
	}

	getClientId() {
		return this.client.getClientId();
	}

	getMetadata() {
		return this.metadata;
	}

	disconnect(): void {
		// We don't need to send the DidDataChange event because it will be triggered
		// when the client is actually closed.
		this.client.dispose();
	}

	async getChildren() {
		if (this._children === undefined) {
			const children = await this.client.listObjects([]);
			this._children = await Promise.all(children.map(async (item) => {
				return await PositronConnectionItem.init(this.onDidChangeDataEmitter, [item], this.client);
			}));
		}
		return this._children;
	}

	async hasChildren() {
		return true;
	}

	get name() {
		return this.metadata.name;
	}

	async getIcon() {
		return this.client.getIcon([]);
	}

	get kind() {
		return 'database';
	}

	get expanded() {
		return this._expanded;
	}

	get active() {
		return this._active;
	}
}

interface ConnectionMetadata {
	name: string;
	language_id: string;
	// host and type are used to identify a unique connection
	host?: string;
	type?: string;
	code?: string;
}

class PositronConnectionItem implements IPositronConnectionItem {

	readonly _name: string;
	readonly _kind: string;
	readonly active: boolean = true;

	_expanded: boolean | undefined;
	_icon: string | undefined;
	_children: IPositronConnectionItem[] | undefined;
	_has_children: boolean | undefined;

	onToggleExpandEmitter: Emitter<void> = new Emitter<void>();
	onToggleExpand: Event<void> = this.onToggleExpandEmitter.event;

	static async init(onDidChangeDataEmitter: Emitter<void>, path: PathSchema[], client: ConnectionsClientInstance) {
		const object = new PositronConnectionItem(onDidChangeDataEmitter, path, client);
		const expandable = await object.hasChildren();

		if (expandable) {
			object._expanded = false;
		} else {
			object._expanded = undefined;
		}

		return object;
	}

	private constructor(
		readonly onDidChangeDataEmitter: Emitter<void>,
		private readonly path: PathSchema[],
		private readonly client: ConnectionsClientInstance,
	) {
		if (this.path.length === 0) {
			throw new Error('path must be length > 0');
		}

		const last_elt = this.path.at(-1)!;
		this._name = last_elt.name;
		this._kind = last_elt.kind;

		this.onToggleExpand(() => {
			if (!(this._expanded === undefined)) {
				this._expanded = !this._expanded;
				// Changing the expanded flag will change the data that we want to show.
				this.onDidChangeDataEmitter.fire();
			}
		});
	}

	get name() {
		return this._name;
	}

	get kind() {
		return this._kind;
	}

	async getIcon() {
		if (!this._icon) {
			this._icon = await this.client.getIcon(this.path);
		}
		return this._icon;
	}

	async getChildren() {
		if (!this._children) {
			let children: PathSchema[];
			const containsData = await this.client.containsData(this.path);
			if (containsData) {
				children = (await this.client.listFields(this.path)).map((item) => {
					return { ...item, kind: 'field' };
				});
			} else {
				children = await this.client.listObjects(this.path);
			}

			this._children = await Promise.all(children.map(async (item) => {
				return await PositronConnectionItem.init(this.onDidChangeDataEmitter, [...this.path, item], this.client);
			}));
		}
		return this._children;
	}

	async hasChildren() {
		if (this._has_children === undefined) {
			// Anmything other than the 'field' type is said to have children.
			this._has_children = this._kind !== 'field';
		}

		return this._has_children;
	}

	get expanded() {
		return this._expanded;
	}
}
