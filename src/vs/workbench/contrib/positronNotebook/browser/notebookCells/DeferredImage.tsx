/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './DeferredImage.css';

// React.
import React from 'react';

// Other dependencies.
import { useNotebookInstance } from '../NotebookInstanceProvider.js';
import { URI } from '../../../../../base/common/uri.js';
import { Schemas } from '../../../../../base/common/network.js';
import { dirname } from '../../../../../base/common/resources.js';
import { localize } from '../../../../../nls.js';
import { createCancelablePromise, raceTimeout } from '../../../../../base/common/async.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';

/**
 * This should match the error message defined in the command definition
 * (extensions/positron-notebooks/src/extension.ts)
 */
type CoversionErrorMsg = {
	status: 'error';
	message: string;
};

/**
 * Predicate function to allow us to be safe with our response processing from command.
 * @param x: Variable of unknown type to check if it is a `CoversionErrorMsg`.
 * @returns Whether the object is a `CoversionErrorMsg`.
 */
function isConversionErrorMsg(x: unknown): x is CoversionErrorMsg {
	return x !== null && typeof x === 'object' && 'status' in x && x.status === 'error' && 'message' in x;
}

type ImageDataResults = {
	status: 'pending';
} | {
	status: 'success';
	data: string;
} | {
	status: 'error';
	message: string;
};

const CONVERSION_TIMEOUT_MS = 3000;
const ERROR_TIMEOUT_MS = 1000;

/**
 * Special image component that defers loading of the image while it converts it to a data-url using
 * the `positronNotebookHelpers.convertImageToBase64` command.
 * @param props: Props for `img` element.
 * @returns Image tag that shows the image once it is loaded.
 */
export function DeferredImage({ src = 'no-source', ...props }: React.ComponentPropsWithoutRef<'img'>) {
	const services = usePositronReactServicesContext();
	const notebookInstance = useNotebookInstance();

	const [results, setResults] = React.useState<ImageDataResults>({ status: 'pending' });

	React.useEffect(() => {

		/**
		 * Handles fetching and converting remote SVG images to base64 data URLs.
		 *
		 * @param imageUrl The SVG URL to fetch
		 * @param commandService Service to execute extension commands
		 * @param logService Service to log errors
		 * @returns Cleanup function to cancel ongoing operations
		 */
		const handleRemoteSvg = (
			imageUrl: string,
			commandService: typeof services.commandService,
			logService: typeof services.logService
		): (() => void) => {
			let delayedErrorMsg: Timeout;

			// Create cancelable promise to fetch and convert the SVG
			const conversionCancellablePromise = createCancelablePromise(() => raceTimeout(
				commandService.executeCommand('positronNotebookHelpers.fetchRemoteImage', imageUrl),
				CONVERSION_TIMEOUT_MS
			));

			// Handle the conversion result
			conversionCancellablePromise.then((payload) => {
				if (typeof payload === 'string') {
					// Success: got base64 data URL
					setResults({ status: 'success', data: payload });
				} else if (isConversionErrorMsg(payload)) {
					// Known error from the command
					delayedErrorMsg = setTimeout(() => {
						logService.error(
							localize('failedToFetchRemote', 'Failed to fetch remote image:'),
							imageUrl,
							payload.message
						);
					}, ERROR_TIMEOUT_MS);
					setResults(payload);
				} else {
					// Unexpected response format
					const unexpectedResponseString = localize('fetchRemoteImage.unexpectedResponse', 'Unexpected response from fetchRemoteImage');
					delayedErrorMsg = setTimeout(() => {
						logService.error(unexpectedResponseString, payload);
					}, ERROR_TIMEOUT_MS);
					setResults({ status: 'error', message: unexpectedResponseString });
				}
			}).catch((err) => {
				// Promise was rejected (timeout or other error)
				setResults({ status: 'error', message: err.message });
			});

			// Return cleanup function for React effect
			return () => {
				clearTimeout(delayedErrorMsg);
				conversionCancellablePromise.cancel();
			};
		};

		// Check for remote images (http/https URLs)
		if (src.startsWith('http://') || src.startsWith('https://')) {
			const isSvg = isSvgUrl(src);
			/**
			 * Remote SVGs are blocked by VS Code's security policy when loaded directly
			 * in the main window context (see `src/vs/code/electron-main/app.ts:221-303`).
			 * We safely handle SVGs by fetching the svg via the extension host and
			 * converting to base64 data URLs.
			 *
			 * Other formats (PNG, JPG, etc.) work natively and can be loaded directly.
			 */
			if (isSvg) {
				// Handle remote SVG through extension
				return handleRemoteSvg(src, services.commandService, services.logService);
			} else {
				// Non-SVG remote images (PNG, JPG, etc.) work natively, use direct URL
				setResults({ status: 'success', data: src });
				return;
			}
		}

		// Get base location for relative image paths.
		let baseLocation: string;
		try {
			baseLocation = getNotebookBaseUri(notebookInstance.uri).path;
		} catch (error) {
			setResults({ status: 'error', message: String(error) });
			return;
		}

		let delayedErrorMsg: Timeout;

		const conversionCancellablePromise = createCancelablePromise(() => raceTimeout(
			services.commandService.executeCommand('positronNotebookHelpers.convertImageToBase64', src, baseLocation),
			CONVERSION_TIMEOUT_MS
		));

		conversionCancellablePromise.then((payload) => {
			if (typeof payload === 'string') {
				setResults({ status: 'success', data: payload });
			} else if (isConversionErrorMsg(payload)) {

				delayedErrorMsg = setTimeout(() => {
					services.logService.error(localize('failedToConvertImageToBase64', 'Failed to convert image to base64:'), src, payload.message);
				}, ERROR_TIMEOUT_MS);

				setResults(payload);
			} else {
				const unexpectedResponseString = localize('convertImageToBase64.unexpectedResponse', 'Unexpected response from convertImageToBase64');
				delayedErrorMsg = setTimeout(() => {
					services.logService.error(unexpectedResponseString, payload);
				}, ERROR_TIMEOUT_MS);
				setResults({ status: 'error', message: unexpectedResponseString });
			}
		}).catch((err) => {
			setResults({ status: 'error', message: err.message });
		});

		return () => {
			clearTimeout(delayedErrorMsg);
			conversionCancellablePromise.cancel();
		};
	}, [src, notebookInstance, services]);

	switch (results.status) {
		case 'pending':
			return <div
				aria-label={(() => localize('deferredImageLoading', 'Loading image...'))()}
				className='positron-notebooks-deferred-img-placeholder'
				role='img'
				{...props}
			></div>;
		case 'error':
			// Show image tag without attempt to convert. Probably will be broken but will provide
			// clue as to what's going on.
			return <img {...props} aria-label={results.message} />;
		case 'success':
			return <img src={results.data} {...props} />;
	}
}

/**
 * Detects if a URL points to an SVG file based on its path extension.
 *
 * @param url The URL to check
 * @returns true if the URL path ends with .svg extension
 */
function isSvgUrl(url: string): boolean {
	try {
		const urlObj = new URL(url);
		// Get the pathname without query params or fragments
		const pathname = urlObj.pathname.toLowerCase();
		// Check if it ends with .svg
		return pathname.endsWith('.svg');
	} catch {
		// If URL parsing fails, fall back to simple check
		return url.toLowerCase().endsWith('.svg');
	}
}

function getNotebookBaseUri(notebookUri: URI) {
	if (notebookUri.scheme === Schemas.untitled) {
		// TODO: Use workspace context service to set the base URI to workspace root
		throw new Error('Have not yet implemented untitled notebook URIs');
	}

	return dirname(notebookUri);
}
