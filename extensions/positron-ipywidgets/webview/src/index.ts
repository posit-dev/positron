/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as base from '@jupyter-widgets/base';
import * as controls from '@jupyter-widgets/controls';
import * as LuminoWidget from '@lumino/widgets';
// import * as outputs from '@jupyter-widgets/jupyterlab-manager/lib/output';
import { ManagerBase, IManagerState } from '@jupyter-widgets/base-manager';
// TODO: Do we really need to depend on this?
import { JSONObject } from '@lumino/coreutils';

const vscode = acquireVsCodeApi();


interface ICommInfoReply {
	comms: { comm_id: string }[];
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

	protected override _create_comm(comm_target_name: string, model_id?: string | undefined, data?: JSONObject | undefined, metadata?: JSONObject | undefined, buffers?: ArrayBuffer[] | ArrayBufferView[] | undefined): Promise<base.IClassicComm> {
		console.log('_create_comm', comm_target_name, model_id, data, metadata, buffers);
		throw new Error('Method not implemented.');
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
}

const manager = new HTMLManager();


async function renderManager(
	element: HTMLElement,
	widgetState: unknown,
): Promise<void> {
	// TODO: validate widgetState?
	// const valid = model_validate(widgetState);
	// if (!valid) {
	//   throw new Error(`Model state has errors: ${model_validate.errors}`);
	// }
	const models = await manager.set_state(widgetState as IManagerState);
	const tags = element.querySelectorAll(
		'script[type="application/vnd.jupyter.widget-view+json"]'
	);
	await Promise.all(
		Array.from(tags).map(async (viewtag) => {
			const widgetViewObject = JSON.parse(viewtag.innerHTML);
			// TODO: validate view state?
			// const valid = view_validate(widgetViewObject);
			// if (!valid) {
			// 	throw new Error(`View state has errors: ${view_validate.errors}`);
			// }
			const model_id: string = widgetViewObject.model_id;
			const model = models.find((item) => item.model_id === model_id);
			if (model !== undefined && viewtag.parentElement !== null) {
				const prev = viewtag.previousElementSibling;
				if (
					prev &&
					prev.tagName === 'img' &&
					prev.classList.contains('jupyter-widget')
				) {
					viewtag.parentElement.removeChild(prev);
				}
				const widgetTag = document.createElement('div');
				widgetTag.className = 'widget-subarea';
				viewtag.parentElement.insertBefore(widgetTag, viewtag);
				const view = await manager.create_view(model);
				manager.display_view(view, widgetTag);
			}
		})
	);
}


async function renderWidgets() {
	const element = document.documentElement;
	const tags = element.querySelectorAll(
		'script[type="application/vnd.jupyter.widget-state+json"]'
	);
	await Promise.all(
		Array.from(tags).map(async (t) =>
			renderManager(element, JSON.parse(t.innerHTML))
		)
	);
}

window.addEventListener('load', () => {
	renderWidgets().then(() => {
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
	}
});
