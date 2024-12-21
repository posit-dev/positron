/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AddressInfo } from 'net';
import { ProxyServerStyles } from './extension';

/**
 * ContentRewriter type.
 */
export type ContentRewriter = (
	serverOrigin: string,
	proxyPath: string,
	url: string,
	contentType: string,
	responseBuffer: Buffer,
	htmlConfig?: ProxyServerHtml
) => Promise<Buffer | string>;

/**
 * PendingProxyServer type.
 */
export type PendingProxyServer = {
	externalUri: vscode.Uri;
	proxyPath: string;
	finishProxySetup: (targetOrigin: string) => Promise<void>;
};

/**
 * MaybeAddressInfo type.
 */
export type MaybeAddressInfo = AddressInfo | string | null | undefined;

/**
 * Custom type guard for AddressInfo.
 * @param addressInfo The value to type guard.
 * @returns true if the value is an AddressInfo; otherwise, false.
 */
export const isAddressInfo = (
	addressInfo: MaybeAddressInfo
): addressInfo is AddressInfo =>
	(addressInfo as AddressInfo).address !== undefined &&
	(addressInfo as AddressInfo).family !== undefined &&
	(addressInfo as AddressInfo).port !== undefined;

/**
 * ProxyServerHtml class.
 */
export class ProxyServerHtml {
	styleDefaults?: string;
	styleOverrides?: string;
	script?: string;
	styles?: ProxyServerStyles;

	constructor(
		styleDefaults?: string,
		styleOverrides?: string,
		script?: string,
		styles?: ProxyServerStyles,

	) {
		this.styleDefaults = styleDefaults;
		this.styleOverrides = styleOverrides;
		this.script = script;
		this.styles = styles;
	}

	/**
	 * Function to check if all resources are loaded.
	 * @returns true if styles, styleDefaults, and styleOverrides are all defined; otherwise, false.
	 */
	resourcesLoaded(): boolean {
		return this.styleDefaults !== undefined
			&& this.styleOverrides !== undefined
			&& this.script !== undefined;
	}
};

/**
 * ProxyServerHtmlConfig type.
 */
export interface ProxyServerHtmlConfig {
	help: ProxyServerHtml;
	preview: ProxyServerHtml;
}

/**
 * ProxyServerType type.
 */
export enum ProxyServerType {
	Help = 'help', // Proxy server for Help pane content.
	Preview = 'preview', // Proxy server for HTML or Preview pane content.
}
