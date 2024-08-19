/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { bufferToStream, VSBuffer } from 'vs/base/common/buffer';
import { CancellationToken } from 'vs/base/common/cancellation';
import { canceled } from 'vs/base/common/errors';
import { IHeaders, IRequestContext, IRequestOptions, OfflineError } from 'vs/base/parts/request/common/request';

export async function request(options: IRequestOptions, token: CancellationToken): Promise<IRequestContext> {
	if (token.isCancellationRequested) {
		throw canceled();
	}

	const cancellation = new AbortController();
	const disposable = token.onCancellationRequested(() => cancellation.abort());
	const signal = options.timeout ? AbortSignal.any([
		cancellation.signal,
		AbortSignal.timeout(options.timeout),
	]) : cancellation.signal;

	try {
		const res = await fetch(options.url || '', {
			method: options.type || 'GET',
			headers: getRequestHeaders(options),
			body: options.data,
			signal,
		});
		return {
			res: {
				statusCode: res.status,
				headers: getResponseHeaders(res),
			},
			stream: bufferToStream(VSBuffer.wrap(new Uint8Array(await res.arrayBuffer()))),
		};
	} catch (err) {
		if (!navigator.onLine) {
			throw new OfflineError();
		}
		if (err?.name === 'AbortError') {
			throw canceled();
		}
		if (err?.name === 'TimeoutError') {
			throw new Error(`Fetch timeout: ${options.timeout}ms`);
		}
		throw err;
	} finally {
		disposable.dispose();
	}
}

function getRequestHeaders(options: IRequestOptions) {
	if (options.headers || options.user || options.password || options.proxyAuthorization) {
		const headers: HeadersInit = new Headers();
		outer: for (const k in options.headers) {
			switch (k.toLowerCase()) {
				case 'user-agent':
				case 'accept-encoding':
				case 'content-length':
					// unsafe headers
					continue outer;
			}
			const header = options.headers[k];
			if (typeof header === 'string') {
				headers.set(k, header);
			} else if (Array.isArray(header)) {
				for (const h of header) {
					headers.append(k, h);
				}
			}
		}
		if (options.user || options.password) {
			headers.set('Authorization', 'Basic ' + btoa(`${options.user || ''}:${options.password || ''}`));
		}
		if (options.proxyAuthorization) {
			headers.set('Proxy-Authorization', options.proxyAuthorization);
		}
		return headers;
	}
	return undefined;
}

function getResponseHeaders(res: Response): IHeaders {
	const headers: IHeaders = Object.create(null);
	res.headers.forEach((value, key) => {
		if (headers[key]) {
			if (Array.isArray(headers[key])) {
				headers[key].push(value);
			} else {
				headers[key] = [headers[key], value];
			}
		} else {
			headers[key] = value;
		}
	});
	return headers;
}
