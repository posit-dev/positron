/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IPositronPlotClient } from '../../positronPlots/common/positronPlots.js';
import { IPositronNotebookInstance } from '../../../contrib/positronNotebook/browser/IPositronNotebookInstance.js';

export const POSITRON_HOLOVIEWS_ID = 'positronWebviewPreloadService';

export const IPositronWebviewPreloadService = createDecorator<IPositronWebviewPreloadService>(POSITRON_HOLOVIEWS_ID);


/**
 * The results of a notebook output message that may have a webview preload. Either a preload
 * message or a display message. If it is a display message, the webview is a promise of a
 * disposable container of a webview.
 */
export type NotebookPreloadOutputResults =
	| { preloadMessageType: 'preload' }
	| {
		preloadMessageType: 'display';
		// We stub out a basic approximation here to avoid jumping through hoops for import ordering
		// rules.
		webview: Promise<{
			readonly id: string;
			readonly sessionId: string;
			dispose(): void;
			readonly onDidRender: Event<void>;
		}>;
	};

export interface IPositronWebviewPreloadService {
	/**
	 * Needed for service branding in dependency injector.
	 */
	readonly _serviceBrand: undefined;

	/**
	 * Placeholder for service initialization.
	 */
	initialize(): void;

	/**
	 * Notifies subscribers when a new plot client is created from HoloViews.
	 */
	readonly onDidCreatePlot: Event<IPositronPlotClient>;

	/**
	 * Session info (used for testing)
	 */
	sessionInfo(sessionId: string): { numberOfMessages: number } | null;


	/**
	 * Add a notebook to the known list for replay of messages when creating webviews.
	 * @param instance Instance for the notebook
	 */
	attachNotebookInstance(instance: IPositronNotebookInstance): void;

	/**
	 * Add output from a notebook cell and process it for webview preloads
	 */
	addNotebookOutput(
		opts:
			{
				instance: IPositronNotebookInstance;
				outputId: string;
				outputs: { mime: string; data: VSBuffer }[];
			}
	): NotebookPreloadOutputResults | undefined;
}
