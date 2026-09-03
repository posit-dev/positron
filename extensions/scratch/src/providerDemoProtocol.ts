/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The message channel between the extension host and the demo webview.
 *
 * This file is deliberately types-only. The webview imports it with
 * `import type`, so nothing here survives into the browser bundle and the
 * webview never pulls in extension-host code.
 *
 * The channel itself is `webview.postMessage` / `webview.onDidReceiveMessage`,
 * which already exists. That is the whole point of the demo: adding a screen or
 * a new message needs no change to Positron, only to the two ends of this file.
 */

/** A provider as the webview sees it. A projection of positron.ai.LanguageModelSource. */
export interface DemoProvider {
	readonly id: string;
	readonly displayName: string;
	readonly signedIn: boolean;
	readonly status: string | null;
	readonly statusMessage: string | undefined;
	/**
	 * Which config fields the provider declares support for. The demo renders an
	 * input for `apiKey` and `baseUrl` when they appear here; this list is the
	 * closed vocabulary core defines, so it is the whole set of fields any
	 * provider form can offer.
	 */
	readonly supportedOptions: readonly string[];
	readonly authMethods: readonly string[] | undefined;
	/**
	 * The provider's default base URL, shown as the base-URL input's placeholder.
	 * Only a hint -- it is not submitted unless the user types it.
	 *
	 * There is deliberately no equivalent for `apiKey`: a saved key must not be
	 * sent into a webview just to prefill a form.
	 */
	readonly baseUrlDefault: string | undefined;
}

/**
 * The subset of positron.ai.LanguageModelConfig the demo collects.
 *
 * A field is present only when the user actually typed something, so an
 * untouched form submits `{}` and cannot clear a stored value by accident.
 */
export interface DemoConfig {
	readonly apiKey?: string;
	readonly baseUrl?: string;
}

/** Extension host -> webview. */
export type HostMessage =
	| {
		readonly type: 'providers';
		readonly providers: readonly DemoProvider[];
	}
	| {
		readonly type: 'result';
		/** Correlates with the `requestId` of the request that produced it. */
		readonly requestId: number;
		readonly ok: boolean;
		readonly detail: string;
	};

/** Webview -> extension host. */
export type WebviewMessage =
	| {
		/** Sent once the React tree has mounted and can accept a provider list. */
		readonly type: 'ready';
	}
	| {
		readonly type: 'refresh';
	}
	| {
		/** Drive a legacy provider action through the transitional core bridge. */
		readonly type: 'runAction';
		readonly requestId: number;
		readonly providerId: string;
		readonly action: string;
		/**
		 * Populated for `save`, which is the only verb that reads it. The other
		 * verbs get `{}` so a half-filled form cannot ride along with, say,
		 * `delete`.
		 */
		readonly config: DemoConfig;
	}
	| {
		/** Read a provider's credential out of the authentication extension. */
		readonly type: 'inspectCredential';
		readonly requestId: number;
		readonly providerId: string;
	}
	| {
		/**
		 * Close the panel. A webview is an iframe, so an Escape keydown inside it
		 * never reaches the modal's own key handling -- the content has to forward
		 * it explicitly.
		 */
		readonly type: 'close';
	};
