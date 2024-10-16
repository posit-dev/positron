/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ConnectionsClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeConnectionsClient';
import { ConnectionMetadata, IPositronConnectionInstance, IPositronConnectionItem } from 'vs/workbench/services/positronConnections/browser/interfaces/positronConnectionsInstance';
import { ObjectSchema } from 'vs/workbench/services/languageRuntime/common/positronConnectionsComm';
import { IRuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { RuntimeCodeExecutionMode, RuntimeErrorBehavior } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { ILogService } from 'vs/platform/log/common/log';

interface PathSchema extends ObjectSchema {
	dtype?: string;
}

interface ConnectionsService {
	runtimeSessionService: IRuntimeSessionService;
	logService: ILogService;
	onDidFocusEmitter: Emitter<void>;
	onDidChangeDataEmitter: Emitter<void>;
}

class BaseConnectionsInstance extends Disposable {
	constructor(
		readonly metadata: ConnectionMetadata
	) {
		super();
	}

	get id() {
		// We use host, type and language_id to identify a unique connection.
		const host = (this.metadata.host !== undefined) ? this.metadata.host : 'undefined';
		const type = (this.metadata.type !== undefined) ? this.metadata.type : 'undefined';
		const language_id = this.metadata.language_id;
		return `host-${host}-type-${type}-language_id-${language_id}`;
	}

	get name() {
		return this.metadata.name;
	}

	get language_id() {
		return this.metadata.language_id;
	}

	get icon() {
		return this.metadata.icon;
	}
}

export class PositronConnectionsInstance extends BaseConnectionsInstance implements IPositronConnectionInstance {

	readonly onToggleExpandEmitter: Emitter<void> = new Emitter<void>();
	private readonly onToggleExpand: Event<void> = this.onToggleExpandEmitter.event;

	readonly onDidChangeDataEmitter: Emitter<void>;

	private _expanded: boolean = false;
	private _active: boolean = true;
	private _children: IPositronConnectionItem[] | undefined;

	static async init(metadata: ConnectionMetadata, client: ConnectionsClientInstance, service: ConnectionsService) {
		const object = new PositronConnectionsInstance(metadata, client, service);
		if (!object.metadata.icon) {
			try {
				// Failing to acquire the icon is fine
				// We just log the error
				object.metadata.icon = await object.getIcon();
			} catch (err: any) {
				service.logService.error(`Failed to get icon for ${object.id}: ${err.message}`);
			}
		}
		return object;
	}

	private constructor(
		metadata: ConnectionMetadata,
		private readonly client: ConnectionsClientInstance,
		private readonly service: ConnectionsService,
	) {
		super(metadata);

		this.onDidChangeDataEmitter = service.onDidChangeDataEmitter;

		this._register(this.onToggleExpand(() => {
			this._expanded = !this._expanded;
			this.service.onDidChangeDataEmitter.fire();
		}));

		this._register(this.client.onDidClose(() => {
			this._active = false;
			this._expanded = false;
			this.service.onDidChangeDataEmitter.fire();
		}));

		this._register(this.client.onDidFocus(() => {
			this.service.onDidFocusEmitter.fire();
		}));
	}

	readonly kind: string = 'database';

	async hasChildren() {
		return true;
	}

	async getChildren() {
		if (this._children === undefined) {
			const children = await this.client.listObjects([]);
			this._children = await Promise.all(children.map(async (item) => {
				return await PositronConnectionItem.init(
					[item],
					this.client,
					this.id,
					this.service
				);
			}));
		}
		return this._children;
	}

	get expanded() {
		return this._expanded;
	}

	get active() {
		return this._active;
	}

	get connect() {
		if (!this.metadata.code) {
			// No code, no connect method.
			return undefined;
		}

		return async () => {
			const language_id = this.metadata.language_id;
			const session = this.service.runtimeSessionService.getConsoleSessionForLanguage(language_id);

			if (!session) {
				throw new Error(`No console session for language ${language_id}`);
			}

			// We have checked that before, but it might have been removed somehow.
			if (!this.metadata.code) {
				throw new Error('No code to execute');
			}

			session.execute(
				this.metadata.code,
				this.metadata.name,
				RuntimeCodeExecutionMode.Interactive,
				RuntimeErrorBehavior.Continue
			);
		};
	}

	get disconnect() {
		if (!this._active) {
			// Not active, can't be disconected.
			return undefined;
		}

		return async () => {
			// We don't need to send the DidDataChange event because it will be triggered
			// when the client is actually closed.
			this.client.dispose();
		};
	}

	get refresh() {
		if (!this._active) {
			// Not active, can't be refreshed.
			return undefined;
		}

		return async () => {
			this._children = undefined;
			this.onDidChangeDataEmitter.fire();
		};
	}

	private async getIcon() {
		return this.client.getIcon([]);
	}
}

export class DisconnectedPositronConnectionsInstance extends BaseConnectionsInstance implements IPositronConnectionInstance {
	constructor(
		metadata: ConnectionMetadata,
		readonly onDidChangeDataEmitter: Emitter<void>,
		readonly runtimeSessionService: IRuntimeSessionService,
	) {
		super(metadata);
	}

	readonly kind: string = 'database';
	readonly expanded: boolean | undefined = false;
	readonly active: boolean = false;

	get connect() {
		if (!this.metadata.code) {
			// No code, no connect method.
			return undefined;
		}

		return async () => {
			const language_id = this.metadata.language_id;
			const session = this.runtimeSessionService.getConsoleSessionForLanguage(language_id);

			if (!session) {
				throw new Error(`No console session for language ${language_id}`);
			}

			// We have checked that before, but it might have been removed somehow.
			if (!this.metadata.code) {
				throw new Error('No code to execute');
			}

			session.execute(
				this.metadata.code,
				this.metadata.name,
				RuntimeCodeExecutionMode.Interactive,
				RuntimeErrorBehavior.Continue
			);
		};
	}
}

class PositronConnectionItem implements IPositronConnectionItem {

	private readonly _name: string;
	private readonly _kind: string;
	private readonly _dtype?: string;
	readonly active: boolean = true;

	private _expanded: boolean | undefined;
	private _has_viewer: boolean | undefined;
	private _icon: string | undefined;
	private _children: IPositronConnectionItem[] | undefined;
	private _has_children: boolean | undefined;

	public error?: string;

	onToggleExpandEmitter: Emitter<void> = new Emitter<void>();
	private readonly onToggleExpand: Event<void> = this.onToggleExpandEmitter.event;

	onDidChangeDataEmitter: Emitter<void>;

	static async init(path: PathSchema[], client: ConnectionsClientInstance, parent_id: string, service: ConnectionsService) {
		const object = new PositronConnectionItem(path, client, parent_id, service);

		let expandable;
		try {
			// Failing to check if the object is expandable should not be fatal.
			// We'll mark it as 'errored' and keep is non-expandable.
			// The user might want to refresh to retry if this happens.
			expandable = await object.hasChildren();
		} catch (err: any) {
			object.error = err.message;
		}

		if (expandable) {
			object._expanded = false;
		} else {
			object._expanded = undefined;
		}

		if (!object._icon) {
			// Failing to get the icon is OK.
			// We only log it.
			try {
				object._icon = await object.getIcon();
			} catch (err: any) {
				service.logService.error(`Failed to get icon for ${object.id}: ${err.message}`);
			}
		}

		// Calling object.hasViewer() would be enough to set that flag the internal
		// _has_viwer flag, because it's used as a cache. But we wanted to make this
		// explicit.
		object._has_viewer = await object.hasViewer();
		return object;
	}

	private constructor(
		private readonly path: PathSchema[],
		private readonly client: ConnectionsClientInstance,
		private readonly parent_id: string,
		private readonly service: ConnectionsService
	) {
		if (this.path.length === 0) {
			throw new Error('path must be length > 0');
		}

		this.onDidChangeDataEmitter = this.service.onDidChangeDataEmitter;

		const last_elt = this.path.at(-1)!;
		this._name = last_elt.name;
		this._kind = last_elt.kind;
		this._dtype = last_elt.dtype;

		this.onToggleExpand(() => {
			if (!(this._expanded === undefined)) {
				this._expanded = !this._expanded;
				// Changing the expanded flag will change the data that we want to show.
				this.onDidChangeDataEmitter.fire();
			}
		});
	}

	get id() {
		return `${this.parent_id}-name:${this._name}`;
	}

	get name() {
		return this._name;
	}

	get kind() {
		return this._kind;
	}

	get dtype() {
		return this._dtype;
	}

	get icon() {
		return this._icon;
	}

	get expanded() {
		return this._expanded;
	}

	get preview() {
		if (!this._has_viewer) {
			return undefined;
		}

		return async () => {
			await this.client.previewObject(this.path);
		};
	}

	async hasChildren() {
		if (this._has_children === undefined) {
			// Anything other than the 'field' type is said to have children.
			this._has_children = this._kind !== 'field';
		}

		return this._has_children;
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
				return await PositronConnectionItem.init(
					[...this.path, item],
					this.client,
					this.id,
					this.service
				);
			}));
		}
		return this._children;
	}

	private async getIcon() {
		const icon = await this.client.getIcon(this.path);
		if (icon === '') {
			return undefined;
		} else {
			return icon;
		}
	}

	private async hasViewer() {
		if (this._has_viewer === undefined) {
			this._has_viewer = await this.client.containsData(this.path);
		}
		return this._has_viewer;
	}
}
