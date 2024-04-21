/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { DOMWidgetView, IClassicComm, WidgetModel, WidgetView } from '@jupyter-widgets/base';
import { ManagerBase, IManagerState } from '@jupyter-widgets/base-manager';
import { JSONObject } from '@lumino/coreutils';

const vscode = acquireVsCodeApi();


interface ICommInfoReply {
	comms: { comm_id: string }[];
}

// TODO: Does everything need to be protected?
class HTMLManager extends ManagerBase {
	// TODO: Can we make a very simple RPC mechanism?
	private commInfoReplyPromise: Promise<ICommInfoReply> | undefined;
	private resolveCommInfoReplyPromise: ((value: ICommInfoReply | PromiseLike<ICommInfoReply>) => void) | undefined;

	// IWidgetManager interface

	protected override loadClass(className: string, moduleName: string, moduleVersion: string): Promise<typeof WidgetModel | typeof WidgetView> {
		console.log('loadClass', className, moduleName, moduleVersion);
		throw new Error('Method not implemented.');
	}

	protected override _create_comm(comm_target_name: string, model_id?: string | undefined, data?: JSONObject | undefined, metadata?: JSONObject | undefined, buffers?: ArrayBuffer[] | ArrayBufferView[] | undefined): Promise<IClassicComm> {
		console.log('_create_comm', comm_target_name, model_id, data, metadata, buffers);
		throw new Error('Method not implemented.');
	}

	protected override _get_comm_info(): Promise<{}> {
		console.log('_get_comm_info');
		if (this.commInfoReplyPromise) {
			return this.commInfoReplyPromise;
		}

		this.commInfoReplyPromise = new Promise<ICommInfoReply>((resolve, reject) => {
			this.resolveCommInfoReplyPromise = resolve;
			setTimeout(() => reject(new Error('Timeout waiting for comm_info_reply')), 5000);
		});

		vscode.postMessage({ type: 'comm_info_request' });

		return this.commInfoReplyPromise;
	}

	// New methods

	async display_view(
		view: Promise<DOMWidgetView> | DOMWidgetView,
		el: HTMLElement
	): Promise<void> {
		console.log('display_view', view, el);
		throw new Error('Method not implemented.');
	}

	onCommInfoReply(comms: ICommInfoReply) {
		if (!this.commInfoReplyPromise) {
			throw new Error('Unexpected comm_info_reply');
		}
		this.resolveCommInfoReplyPromise!(comms);
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
		const comms = (message as ICommInfoReply).comms;
		manager.onCommInfoReply(comms);
	}
});
