/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Event } from 'vs/base/common/event';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { URI } from 'vs/base/common/uri';

export const POSITRON_PREVIEW_VIEW_ID = 'workbench.panel.positronPreview';

export const POSITRON_PREVIEW_SERVICE_ID = 'positronPreviewService';

export const IPositronPreviewService = createDecorator<IPositronPreviewService>(POSITRON_PREVIEW_SERVICE_ID);

/**
 * An interface defining the options used to construct a preview pane item.
 */
export interface IPreviewPaneItemOptions {
	uri: URI;
}

/**
 * An interface fulfilled by preview items that can be displayed in the Positron
 * preview pane.
 */
export interface IPreviewPaneItem extends Disposable {
	/**
	 * The ID of the preview item; unique among all preview items.
	 */
	id: string;

	/**
	 * Whether the preview item is currently being shown in the preview pane.
	 */
	isShowing(): Thenable<boolean>;

	/**
	 * Send a message to the preview's window using `postMessage`.
	 */
	sendMessage(message: Object): Thenable<void>;

	/**
	 * An event that is fired when the preview item receives a message from the
	 * preview's window using `postMessage`.
	 */
	onDidReceiveMessage: Event<Object>;
}

/**
 * IPositronPreviewService interface.
 */
export interface IPositronPreviewService {
	readonly _serviceBrand: undefined;

	/**
	 * Creates a new preview pane item.
	 *
	 * @param options The options used to construct the preview pane item.
	 */
	createPreviewPaneItem(options: IPreviewPaneItemOptions): Thenable<IPreviewPaneItem>;

	/**
	 * An event that is fired when a new preview pane item is created.
	 */
	onDidCreatePreviewPaneItem: Event<IPreviewPaneItem>;

	/**
	 * Returns the list of preview pane items currently being displayed in the
	 * preview pane.
	 */
	get previewPaneItems(): IPreviewPaneItem[];

	get activePreviewPaneItemId(): string;
}
