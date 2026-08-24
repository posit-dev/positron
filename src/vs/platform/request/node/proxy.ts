/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parse as parseUrl, Url } from 'url';
import { isBoolean } from '../../../base/common/types.js';

export type Agent = any;

function getSystemProxyURI(requestURL: Url, env: typeof process.env): string | null {
	if (requestURL.protocol === 'http:') {
		return env.HTTP_PROXY || env.http_proxy || null;
	} else if (requestURL.protocol === 'https:') {
		return env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || null;
	}

	return null;
}

// --- Start PWB: honor http.noProxy and NO_PROXY in node requests ---
// This replicates the proxy bypass semantics of @vscode/proxy-agent
// (shouldBypassProxy, noProxyFromEnv, noProxyFromConfig), which the extension
// host proxy resolver uses, so that `http.noProxy` and the NO_PROXY
// environment variables are interpreted the same way on both paths. (The
// resolver additionally short-circuits localhost/127.0.0.1/::1 to DIRECT
// before any proxy logic; that pre-existing difference is out of scope here.)
// Those helpers are not exported from @vscode/proxy-agent, so they are
// reimplemented here.
//
// Known quirks are preserved deliberately for parity with upstream
// (verified against @vscode/proxy-agent v0.44.0): a `*` wildcard only
// matches as an exact, untrimmed entry, so it is lost in
// `NO_PROXY="localhost, *"`; IPv6 literals are mangled by `split(':', 2)`;
// and glob (`*.example.com`) or CIDR (`10.0.0.0/8`) entries never match.
// Fix these upstream rather than diverging locally.

type NoProxyMatcher = (hostname: string, port: string) => boolean;

function shouldBypassProxy(value: string[]): NoProxyMatcher {
	if (value.includes('*')) {
		return () => true;
	}
	const filters = value
		.map(s => s.trim().split(':', 2))
		.map(([name, port]) => ({ name, port }))
		.filter(filter => !!filter.name)
		.map(({ name, port }) => {
			const domain = name[0] === '.' ? name : `.${name}`;
			return { domain, port };
		});
	if (!filters.length) {
		return () => false;
	}
	return (hostname, port) => filters.some(({ domain, port: filterPort }) => {
		return `.${hostname.toLowerCase()}`.endsWith(domain) && (!filterPort || port === filterPort);
	});
}

function noProxyFromEnv(envValue?: string): NoProxyMatcher {
	const value = (envValue || '')
		.trim()
		.toLowerCase()
		.split(',');
	return shouldBypassProxy(value);
}

function noProxyFromConfig(noProxy: string[]): NoProxyMatcher {
	const value = noProxy
		.map(item => item.trim().toLowerCase());
	return shouldBypassProxy(value);
}

function shouldBypassProxyForURL(requestURL: Url, env: typeof process.env, noProxyConfig: string[] | undefined): boolean {
	const hostname = requestURL.hostname;
	if (!hostname) {
		return false;
	}
	const defaultPort = requestURL.protocol === 'https:' ? '443' : '80';
	const port = String(requestURL.port || defaultPort);
	// `http.noProxy` comes from user or admin settings with no schema-type
	// validation, so a mistyped value (a plain string, or non-string array
	// items) must be ignored rather than crash every request.
	const configEntries = Array.isArray(noProxyConfig) ? noProxyConfig.filter(item => typeof item === 'string') : [];
	// Same precedence as the extension host proxy resolver: when any
	// `http.noProxy` entries are present, the environment variables are
	// ignored.
	if (configEntries.length) {
		return noProxyFromConfig(configEntries)(hostname, port);
	}
	return noProxyFromEnv(env.no_proxy || env.NO_PROXY)(hostname, port);
}
// --- End PWB ---

export interface IOptions {
	proxyUrl?: string;
	strictSSL?: boolean;
	// --- Start PWB: honor http.noProxy and NO_PROXY in node requests ---
	noProxy?: string[];
	// --- End PWB ---
}

export async function getProxyAgent(rawRequestURL: string, env: typeof process.env, options: IOptions = {}): Promise<Agent> {
	const requestURL = parseUrl(rawRequestURL);
	const proxyURL = options.proxyUrl || getSystemProxyURI(requestURL, env);

	if (!proxyURL) {
		return null;
	}

	// --- Start PWB: honor http.noProxy and NO_PROXY in node requests ---
	// The bypass list wins over both `http.proxy` and the proxy environment
	// variables, matching the extension host proxy resolver's precedence.
	// Checked after the guard above so the matcher is only built when a
	// proxy is actually configured.
	if (shouldBypassProxyForURL(requestURL, env, options.noProxy)) {
		return null;
	}
	// --- End PWB ---

	const proxyEndpoint = parseUrl(proxyURL);

	if (!/^https?:$/.test(proxyEndpoint.protocol || '')) {
		return null;
	}

	const opts = {
		host: proxyEndpoint.hostname || '',
		port: (proxyEndpoint.port ? +proxyEndpoint.port : 0) || (proxyEndpoint.protocol === 'https' ? 443 : 80),
		auth: proxyEndpoint.auth,
		rejectUnauthorized: isBoolean(options.strictSSL) ? options.strictSSL : true,
	};

	if (requestURL.protocol === 'http:') {
		const { default: mod } = await import('http-proxy-agent');
		return new mod.HttpProxyAgent(proxyURL, opts);
	} else {
		const { default: mod } = await import('https-proxy-agent');
		return new mod.HttpsProxyAgent(proxyURL, opts);
	}
}
