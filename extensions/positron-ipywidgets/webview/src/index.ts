/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as base from '@jupyter-widgets/base';
import * as controls from '@jupyter-widgets/controls';
import * as LuminoWidget from '@lumino/widgets';
// import * as outputs from '@jupyter-widgets/jupyterlab-manager/lib/output';
import { ManagerBase } from '@jupyter-widgets/base-manager';
// TODO: Do we really need to depend on this?
import { JSONObject, JSONValue } from '@lumino/coreutils';

const vscode = acquireVsCodeApi();


interface ICommInfoReply {
	comms: { comm_id: string }[];
}

const comms = new Map<string, Comm>();

class Comm implements base.IClassicComm {
	private readonly _onMsgCallbacks: ((x: any) => void)[] = [];

	constructor(
		readonly comm_id: string,
		readonly target_name: string,
	) { }

	open(data: JSONValue, callbacks?: base.ICallbacks | undefined, metadata?: JSONObject | undefined, buffers?: ArrayBuffer[] | ArrayBufferView[] | undefined): string {
		console.log('Comm.open', data, callbacks, metadata, buffers);
		// TODO: Move open logic here?
		return '';
	}

	send(data: any, callbacks?: base.ICallbacks | undefined, metadata?: JSONObject | undefined, buffers?: ArrayBuffer[] | ArrayBufferView[] | undefined): string {
		console.log('Comm.send', data, callbacks, metadata, buffers);
		const method = data?.method;
		if (method) {
			vscode.postMessage({
				type: 'comm_msg',
				// TODO: Need content?
				content: {
					comm_id: this.comm_id,
					method
				},
			});
		}
		// TODO: Handle callbacks?
		return '';
	}

	close(data?: JSONValue | undefined, callbacks?: base.ICallbacks | undefined, metadata?: JSONObject | undefined, buffers?: ArrayBuffer[] | ArrayBufferView[] | undefined): string {
		console.log('Comm.close', data, callbacks, metadata, buffers);
		return '';
	}

	on_msg(callback: (x: any) => void): void {
		console.log('Comm.on_msg', callback);
		this._onMsgCallbacks.push(callback);
	}

	on_close(callback: (x: any) => void): void {
		console.log('Comm.on_close', callback);
	}

	handle_msg(message: JSONObject): void {
		console.log('Comm.handle_msg', message);
		for (const callback of this._onMsgCallbacks) {
			callback(message);
		}
	}
}

// TODO: Does everything need to be protected?
class HTMLManager extends ManagerBase {
	// TODO: Can we make a very simple RPC mechanism?
	private commInfoPromise: Promise<string[]> | undefined;
	private resolveCommInfoPromise: ((value: string[] | PromiseLike<string[]>) => void) | undefined;

	// IWidgetManager interface

	protected override loadClass(className: string, moduleName: string, moduleVersion: string): Promise<typeof base.WidgetModel | typeof base.WidgetView> {
		console.log('loadClass', className, moduleName, moduleVersion);
		if (moduleName === '@jupyter-widgets/base') {
			return Promise.resolve((base as any)[className]);
		}
		if (moduleName === '@jupyter-widgets/controls') {
			return Promise.resolve((controls as any)[className]);
		}
		// TODO: Find a usecase for this
		// if (moduleName === '@jupyter-widgets/outputs') {
		// 	return Promise.resolve((outputs as any)[className]);
		// }
		// TODO: We don't actually "register" anything... How does Jupyter Lab do this?
		throw new Error(`No version of module ${moduleName} is registered`);
	}

	protected override async _create_comm(comm_target_name: string, model_id?: string | undefined, data?: JSONObject | undefined, metadata?: JSONObject | undefined, buffers?: ArrayBuffer[] | ArrayBufferView[] | undefined): Promise<base.IClassicComm> {
		console.log('_create_comm', comm_target_name, model_id, data, metadata, buffers);
		if (!model_id) {
			// TODO: Supporting creating a comm from the frontend
			throw new Error('model_id is required');
		}
		vscode.postMessage(
			{
				type: 'comm_open',
				// TODO: need content?
				content: {
					comm_id: model_id,
					target_name: comm_target_name,
					data,
					metadata,
					buffers
				}
			}
		);
		const comm = new Comm(model_id, comm_target_name);
		comms.set(model_id, comm);
		return comm;
	}

	protected override _get_comm_info(): Promise<{}> {
		console.log('_get_comm_info');
		if (this.commInfoPromise) {
			return this.commInfoPromise;
		}

		this.commInfoPromise = new Promise<string[]>((resolve, reject) => {
			this.resolveCommInfoPromise = resolve;
			setTimeout(() => reject(new Error('Timeout waiting for comm_info_reply')), 5000);
		});

		vscode.postMessage({ type: 'comm_info_request' });

		return this.commInfoPromise;
	}

	// New methods

	async display_view(
		view: Promise<base.DOMWidgetView> | base.DOMWidgetView,
		el: HTMLElement
	): Promise<void> {
		let v: base.DOMWidgetView;
		try {
			v = await view;
		} catch (error) {
			const msg = `Could not create a view for ${view}`;
			console.error(msg);
			const ModelCls = base.createErrorWidgetModel(error, msg);
			const errorModel = new ModelCls();
			v = new base.ErrorWidgetView({
				model: errorModel,
			});
			v.render();
		}

		LuminoWidget.Widget.attach(v.luminoWidget, el);
		// TODO: Do we need to maintain a _viewList?
		// this._viewList.add(v);
		// v.once('remove', () => {
		// 	this._viewList.delete(v);
		// });
	}

	onCommInfoReply(message: ICommInfoReply) {
		if (!this.commInfoPromise) {
			throw new Error('Unexpected comm_info_reply');
		}
		// TODO: Should we make the webview container send exactly what's needed for get_comm_info (comm_ids)?
		// TODO: Should we implement a "kernel", or is that too much overhead?
		this.resolveCommInfoPromise!(message.comms.map((comm) => comm.comm_id));
	}

	async loadFromKernel(): Promise<void> {
		return super._loadFromKernel();
	}
}

const manager = new HTMLManager();


window.addEventListener('load', () => {
	manager.loadFromKernel().then(() => {
		vscode.postMessage({ type: 'render_complete' });
	}).catch((error) => {
		console.error('Error rendering widgets:', error);
	});
});

window.addEventListener('message', (event) => {
	console.log('window.onmessage', event);
	const message = event.data;
	if (message?.type === 'comm_info_reply') {
		// TODO: error handling?
		manager.onCommInfoReply(message);
	} else if (message?.type === 'comm_msg') {
		const comm = comms.get(message.comm_id);
		if (!comm) {
			throw new Error(`Comm not found ${message.comm_id}`);
		}
		comm.handle_msg(message);
	}
});
