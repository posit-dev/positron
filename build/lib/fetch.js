"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchUrls = fetchUrls;
exports.fetchUrl = fetchUrl;
exports.fetchGithub = fetchGithub;
const es = require("event-stream");
const VinylFile = require("vinyl");
const log = require("fancy-log");
const ansiColors = require("ansi-colors");
const crypto = require("crypto");
const through2 = require("through2");
// --- Start Positron ---
const util_1 = require("./util");
function fetchUrls(urls, options) {
    if (options === undefined) {
        options = {};
    }
    if (typeof options.base !== 'string' && options.base !== null) {
        options.base = '/';
    }
    if (!Array.isArray(urls)) {
        urls = [urls];
    }
    return es.readArray(urls).pipe(es.map((data, cb) => {
        const url = [options.base, data].join('');
        // --- Start Positron ---
        // Replace call to fetchUrl with fetchUrlQueued to limit the number of
        // concurrent requests to OpenVSX
        fetchUrlQueued(url, options).then(file => {
            cb(undefined, file);
        }, error => {
            cb(error);
        });
        // --- End Positron ---
    }));
}
async function fetchUrl(url, options, retries = 10, retryDelay = 1000) {
    const verbose = !!options.verbose || !!process.env['CI'] || !!process.env['BUILD_ARTIFACTSTAGINGDIRECTORY'];
    try {
        let startTime = 0;
        if (verbose) {
            log(`Start fetching ${ansiColors.magenta(url)}${retries !== 10 ? ` (${10 - retries} retry)` : ''}`);
            startTime = new Date().getTime();
        }
        const controller = new AbortController();
        // --- Start Positron ---
        const timeoutSeconds = options.timeoutSeconds ?? 30;
        const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
        // --- End Positron ---
        try {
            const response = await fetch(url, {
                ...options.nodeFetchOptions,
                signal: controller.signal /* Typings issue with lib.dom.d.ts */
            });
            if (verbose) {
                log(`Fetch completed: Status ${response.status}. Took ${ansiColors.magenta(`${new Date().getTime() - startTime} ms`)}`);
            }
            if (response.ok && (response.status >= 200 && response.status < 300)) {
                const contents = Buffer.from(await response.arrayBuffer());
                if (options.checksumSha256) {
                    const actualSHA256Checksum = crypto.createHash('sha256').update(contents).digest('hex');
                    if (actualSHA256Checksum !== options.checksumSha256) {
                        throw new Error(`Checksum mismatch for ${ansiColors.cyan(url)} (expected ${options.checksumSha256}, actual ${actualSHA256Checksum}))`);
                    }
                    else if (verbose) {
                        log(`Verified SHA256 checksums match for ${ansiColors.cyan(url)}`);
                    }
                }
                else if (verbose) {
                    log(`Skipping checksum verification for ${ansiColors.cyan(url)} because no expected checksum was provided`);
                }
                if (verbose) {
                    log(`Fetched response body buffer: ${ansiColors.magenta(`${contents.byteLength} bytes`)}`);
                }
                return new VinylFile({
                    cwd: '/',
                    base: options.base,
                    path: url,
                    contents
                });
            }
            let err = `Request ${ansiColors.magenta(url)} failed with status code: ${response.status}`;
            if (response.status === 403) {
                err += ' (you may be rate limited)';
            }
            throw new Error(err);
        }
        finally {
            clearTimeout(timeout);
        }
    }
    catch (e) {
        if (verbose) {
            log(`Fetching ${ansiColors.cyan(url)} failed: ${e}`);
        }
        if (retries > 0) {
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            return fetchUrl(url, options, retries - 1, retryDelay);
        }
        throw e;
    }
}
const ghApiHeaders = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'VSCode Build',
};
if (process.env.GITHUB_TOKEN) {
    ghApiHeaders.Authorization = 'Basic ' + Buffer.from(process.env.GITHUB_TOKEN).toString('base64');
}
const ghDownloadHeaders = {
    ...ghApiHeaders,
    Accept: 'application/octet-stream',
};
/**
 * @param repo for example `Microsoft/vscode`
 * @param version for example `16.17.1` - must be a valid releases tag
 * @param assetName for example (name) => name === `win-x64-node.exe` - must be an asset that exists
 * @returns a stream with the asset as file
 */
function fetchGithub(repo, options) {
    return fetchUrls(`/repos/${repo.replace(/^\/|\/$/g, '')}/releases/tags/v${options.version}`, {
        base: 'https://api.github.com',
        verbose: options.verbose,
        nodeFetchOptions: { headers: ghApiHeaders }
    }).pipe(through2.obj(async function (file, _enc, callback) {
        const assetFilter = typeof options.name === 'string' ? (name) => name === options.name : options.name;
        const asset = JSON.parse(file.contents.toString()).assets.find((a) => assetFilter(a.name));
        if (!asset) {
            return callback(new Error(`Could not find asset in release of ${repo} @ ${options.version}`));
        }
        try {
            callback(null, await fetchUrl(asset.url, {
                nodeFetchOptions: { headers: ghDownloadHeaders },
                verbose: options.verbose,
                checksumSha256: options.checksumSha256
            }));
        }
        catch (error) {
            callback(error);
        }
    }));
}
// --- Start Positron ---
/// A promise that fetches a URL from `fetchUrl` and returns a Vinyl file
class FetchPromise extends util_1.PromiseHandles {
    url;
    options;
    retries;
    retryDelay;
    constructor(url, options, retries = 10, retryDelay = 1000) {
        super();
        this.url = url;
        this.options = options;
        this.retries = retries;
        this.retryDelay = retryDelay;
    }
}
/// An array of fetch promises that are queued to be fetched
const fetchQueue = [];
let fetching = false;
/**
 * Fetches a URL using `fetchUrl` and returns a Vinyl file. This function is
 * similar to the `fetchUrl` function it wraps, but queues the request to limit
 * the number of concurrent requests.
 *
 * @param url The URL to fetch
 * @param options The fetch options
 * @param retries The number of retries to attempt
 * @param retryDelay The delay between retries
 *
 * @returns A promise that resolves to a Vinyl file
 */
function fetchUrlQueued(url, options, retries = 10, retryDelay = 1000) {
    // Create a new fetch promise and push it to the fetch queue
    const promise = new FetchPromise(url, options, retries, retryDelay);
    fetchQueue.push(promise);
    // Process the fetch queue immediately (a no-op if we are already fetching)
    processFetchQueue();
    return promise.promise;
}
/// Processes the fetch queue by fetching the next URL in the queue
function processFetchQueue() {
    // If we are already fetching or the fetch queue is empty, do nothing
    if (fetching) {
        return;
    }
    if (fetchQueue.length === 0) {
        return;
    }
    // Splice off the next URL in the queue
    const next = fetchQueue.splice(0, 1)[0];
    fetching = true;
    // Determine if we should log verbose output (e.g. when running in CI)
    const verbose = !!next.options.verbose || !!process.env['CI'] || !!process.env['BUILD_ARTIFACTSTAGINGDIRECTORY'];
    if (verbose) {
        log(`[Fetch queue] start fetching ${next.url} (${fetchQueue.length} remaining)`);
    }
    // Perform the fetch and resolve the promise when done
    fetchUrl(next.url, next.options, next.retries, next.retryDelay).then((vinyl) => {
        if (verbose) {
            log(`[Fetch queue] completed fetching ${next.url} (${fetchQueue.length} remaining)`);
        }
        next.resolve(vinyl);
    }).catch((e) => {
        if (verbose) {
            log(`[Fetch queue] failed fetching ${next.url} (${fetchQueue.length} remaining): ${e}`);
        }
        next.reject(e);
    }).finally(() => {
        fetching = false;
        processFetchQueue();
    });
}
// --- End Positron ---
//# sourceMappingURL=fetch.js.map