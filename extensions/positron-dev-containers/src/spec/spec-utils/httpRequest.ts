/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { RequestOptions } from 'https';
import { https, http, FollowOptions } from 'follow-redirects';
import { ProxyAgent } from 'proxy-agent';
import * as url from 'url';
import * as tls from 'tls';
import { Log, LogLevel } from './log';
import { readLocalFile } from './pfs';

export async function request(options: { type: string; url: string; headers: Record<string, string>; data?: Buffer }, output: Log) {
	const secureContext = await secureContextWithExtraCerts(output);
	return new Promise<Buffer>((resolve, reject) => {
		const parsed = new url.URL(options.url);
		const reqOptions: RequestOptions & tls.CommonConnectionOptions = {
			hostname: parsed.hostname,
			port: parsed.port,
			path: parsed.pathname + parsed.search,
			method: options.type,
			headers: options.headers,
			agent: new ProxyAgent(),
			secureContext,
		};

		const plainHTTP = parsed.protocol === 'http:' || parsed.hostname === 'localhost';
		if (plainHTTP) {
			output.write('Sending as plain HTTP request', LogLevel.Warning);
		}

		const req = (plainHTTP ? http : https).request(reqOptions, res => {
			if (res.statusCode! < 200 || res.statusCode! > 299) {
				reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
				output.write(`[-] HTTP request failed with status code ${res.statusCode}: : ${res.statusMessage}`, LogLevel.Trace);
			} else {
				res.on('error', reject);
				const chunks: Buffer[] = [];
				res.on('data', chunk => chunks.push(chunk as Buffer));
				res.on('end', () => resolve(Buffer.concat(chunks)));
			}
		});
		req.on('error', reject);
		if (options.data) {
			req.write(options.data);
		}
		req.end();
	});
}

// HTTP HEAD request that returns status code.
export async function headRequest(options: { url: string; headers: Record<string, string> }, output: Log) {
	const secureContext = await secureContextWithExtraCerts(output);
	return new Promise<number>((resolve, reject) => {
		const parsed = new url.URL(options.url);
		const reqOptions: RequestOptions & tls.CommonConnectionOptions = {
			hostname: parsed.hostname,
			port: parsed.port,
			path: parsed.pathname + parsed.search,
			method: 'HEAD',
			headers: options.headers,
			agent: new ProxyAgent(),
			secureContext,
		};

		const plainHTTP = parsed.protocol === 'http:' || parsed.hostname === 'localhost';
		if (plainHTTP) {
			output.write('Sending as plain HTTP request', LogLevel.Warning);
		}

		const req = (plainHTTP ? http : https).request(reqOptions, res => {
			res.on('error', reject);
			output.write(`HEAD ${options.url} -> ${res.statusCode}`, LogLevel.Trace);
			resolve(res.statusCode!);
		});
		req.on('error', reject);
		req.end();
	});
}

// Send HTTP Request.
// Does not throw on status code, but rather always returns 'statusCode', 'resHeaders', and 'resBody'.
export async function requestResolveHeaders(options: { type: string; url: string; headers: Record<string, string>; data?: Buffer }, output: Log) {
	const secureContext = await secureContextWithExtraCerts(output);
	return new Promise<{ statusCode: number; resHeaders: Record<string, string>; resBody: Buffer }>((resolve, reject) => {
		const parsed = new url.URL(options.url);
		const reqOptions: RequestOptions & tls.CommonConnectionOptions & FollowOptions<any> = {
			hostname: parsed.hostname,
			maxBodyLength: 100 * 1024 * 1024,
			port: parsed.port,
			path: parsed.pathname + parsed.search,
			method: options.type,
			headers: options.headers,
			agent: new ProxyAgent(),
			secureContext,
		};

		const plainHTTP = parsed.protocol === 'http:' || parsed.hostname === 'localhost';
		if (plainHTTP) {
			output.write('Sending as plain HTTP request', LogLevel.Warning);
		}

		const req = (plainHTTP ? http : https).request(reqOptions, res => {
			res.on('error', reject);

			// Resolve response body
			const chunks: Buffer[] = [];
			res.on('data', chunk => chunks.push(chunk as Buffer));
			res.on('end', () => {
				resolve({
					statusCode: res.statusCode!,
					resHeaders: res.headers! as Record<string, string>,
					resBody: Buffer.concat(chunks)
				});
			});
		});

		if (options.data) {
			req.write(options.data);
		}

		req.on('error', reject);
		req.end();
	});
}

let _secureContextWithExtraCerts: Promise<tls.SecureContext | undefined> | undefined;

async function secureContextWithExtraCerts(output: Log, options?: tls.SecureContextOptions) {
	// Work around https://github.com/electron/electron/issues/10257.

	if (_secureContextWithExtraCerts) {
		return _secureContextWithExtraCerts;
	}

	return _secureContextWithExtraCerts = (async () => {
		if (!process.versions.electron || !process.env.NODE_EXTRA_CA_CERTS) {
			return undefined;
		}
	
		try {
			const content = await readLocalFile(process.env.NODE_EXTRA_CA_CERTS, { encoding: 'utf8' });
			const certs = (content.split(/(?=-----BEGIN CERTIFICATE-----)/g)
				.filter(pem => !!pem.length));
			output.write(`Loading ${certs.length} extra certificates from ${process.env.NODE_EXTRA_CA_CERTS}.`);
			if (!certs.length) {
				return undefined;
			}
	
			const secureContext = tls.createSecureContext(options);
			for (const cert of certs) {
				secureContext.context.addCACert(cert);
			}
			return secureContext;
		} catch (err) {
			output.write(`Error loading extra certificates from ${process.env.NODE_EXTRA_CA_CERTS}: ${err.message}`, LogLevel.Error);
			return undefined;
		}
	})();
}
