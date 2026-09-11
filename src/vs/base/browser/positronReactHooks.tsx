/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useRef, useState } from 'react';
import { usePositronReactServicesContext } from './positronReactRendererContext.js';
import { ContextKeyValue, IContextKeyService, RawContextKey } from '../../platform/contextkey/common/contextkey.js';
import { ExtensionIdentifier } from '../../platform/extensions/common/extensions.js';


// How long an operation has to run before it is worth telling the user it is running, and how long
// the indicator stays once it has appeared. See useBusyIndicator.
const BUSY_INDICATOR_DELAY = 250;
const BUSY_INDICATOR_MINIMUM = 400;

/**
 * useBusyIndicator hook. Gates a busy indicator so that a fast operation shows nothing at all and a
 * slow one shows an indicator that stays long enough to read.
 *
 * Two rules, and both are needed. The indicator does not appear until the operation has run for
 * `delayMs`, so an operation that finishes before that -- opening a table on a local PostgreSQL,
 * say -- never swaps the icon and never flashes. Once it has appeared it stays for `minimumMs`, so
 * an operation that finishes just past the delay doesn't blink the indicator out again.
 *
 * A minimum on its own would make the fast case worse rather than better: it turns a 40ms flicker
 * into a spinner that is guaranteed to run for the full minimum on every single open. The delay is
 * what removes the flash; the minimum only keeps the boundary from flickering.
 *
 * @param busy Whether the operation is running.
 * @param delayMs How long the operation must run before the indicator appears.
 * @param minimumMs How long the indicator stays once it has appeared.
 * @returns Whether the indicator should be shown.
 */
export function useBusyIndicator(
	busy: boolean,
	delayMs: number = BUSY_INDICATOR_DELAY,
	minimumMs: number = BUSY_INDICATOR_MINIMUM
): boolean {
	const [showing, setShowing] = useState(false);

	// When the indicator went up, for measuring the minimum against. A ref rather than state: it is
	// read when the operation ends, and writing it should not itself paint.
	const shownAt = useRef(0);

	useEffect(() => {
		// Running and nothing shown yet: hold off until the delay is up. If the operation finishes
		// first this effect is torn down and the timeout never fires, which is the whole point.
		if (busy && !showing) {
			const handle = setTimeout(() => {
				shownAt.current = Date.now();
				setShowing(true);
			}, delayMs);
			return () => clearTimeout(handle);
		}

		// Finished with the indicator up: take it down, but not before it has had its minimum.
		if (!busy && showing) {
			const remaining = minimumMs - (Date.now() - shownAt.current);
			if (remaining <= 0) {
				setShowing(false);
				return undefined;
			}
			const handle = setTimeout(() => setShowing(false), remaining);
			return () => clearTimeout(handle);
		}

		return undefined;
	}, [busy, showing, delayMs, minimumMs]);

	return showing;
}

/**
 * usePositronConfiguration hook.
 * @param key Configuration key to retrieve.
 * @returns The configuration value.
 */
export const usePositronConfiguration = <T,>(key: string): T => {
	const { configurationService } = usePositronReactServicesContext();
	const [value, setValue] = useState(() => configurationService.getValue<T>(key));

	useEffect(() => {
		const disposable = configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(key)) {
				setValue(configurationService.getValue<T>(key));
			}
		});
		return () => disposable.dispose();
	}, [configurationService, key]);

	return value;
};

/**
 * usePositronExtensionInstalled hook.
 *
 * Returns true only when the extension is both installed and enabled.
 * `IExtensionService.extensions` lists registered extensions, and the
 * extension host filters out disabled ones before registering (via
 * `filterEnabledExtensions` in abstractExtensionService.ts). The value
 * updates on install, uninstall, enable, and disable.
 *
 * @param extensionId The identifier of the extension, either as a string
 *   (e.g. 'posit.assistant') or an `ExtensionIdentifier`.
 * @returns True if the extension is installed and enabled.
 */
export const usePositronExtensionInstalled = (extensionId: string | ExtensionIdentifier): boolean => {
	const { extensionService } = usePositronReactServicesContext();
	const key = ExtensionIdentifier.toKey(extensionId);
	const [installed, setInstalled] = useState(() =>
		extensionService.extensions.some(e => ExtensionIdentifier.toKey(e.identifier) === key)
	);

	useEffect(() => {
		const disposable = extensionService.onDidChangeExtensions(() => {
			setInstalled(extensionService.extensions.some(e => ExtensionIdentifier.toKey(e.identifier) === key));
		});
		return () => disposable.dispose();
	}, [extensionService, key]);

	return installed;
};

/**
 * Observe a context key on a specific context key service and re-render when it
 * changes. Pass a scoped service (e.g. an editor's `scopedContextKeyService`)
 * to observe keys set on that scope. While the service is undefined the hook
 * yields undefined and starts observing once a service becomes available.
 * @param key The context key to observe.
 * @param contextKeyService The context key service to observe, or undefined.
 * @returns The current value of the context key, or undefined.
 */
export function useScopedContextKey<T extends ContextKeyValue>(key: RawContextKey<T>, contextKeyService: IContextKeyService | undefined): T | undefined {
	const [value, setValue] = useState<T | undefined>(() => contextKeyService ? key.getValue(contextKeyService) : undefined);

	useEffect(() => {
		if (!contextKeyService) {
			return;
		}

		// Set the initial value in case the service became available after the
		// initial render.
		setValue(key.getValue(contextKeyService));

		const keys = new Set([key.key]);
		const disposable = contextKeyService.onDidChangeContext(e => {
			if (e.affectsSome(keys)) {
				setValue(key.getValue(contextKeyService));
			}
		});
		return () => disposable.dispose();
	}, [key, contextKeyService]);

	return value;
}

/**
 * Observe a context key on the root context key service (from the React
 * services context) and re-render when it changes.
 * @param key The context key to observe.
 * @returns The current value of the context key, or undefined.
 */
export function useContextKey<T extends ContextKeyValue>(key: RawContextKey<T>): T | undefined {
	const { contextKeyService } = usePositronReactServicesContext();
	return useScopedContextKey(key, contextKeyService);
}

/**
 * Observe a context key given only its string key, on the root context key
 * service.
 *
 * @deprecated Prefer {@link useContextKey} with a `RawContextKey<T>`. A
 * `RawContextKey` carries the key's value type and a description that surfaces
 * in `when`-clause autocompletion for keybindings and extension manifests. Use
 * this only when no `RawContextKey` is available for the key (e.g. a key
 * contributed as a bare string by an extension).
 * @param key The context key string to observe.
 * @returns The current value of the context key, or undefined.
 */
export function useContextKeyFromString<T extends ContextKeyValue>(key: string): T | undefined {
	// We could delegate to useScopedContextKey by wrapping the string in a
	// `new RawContextKey(key, undefined, true)`, and today it would behave
	// identically: getValue only reads the service, never the key's default.
	// We deliberately don't. This is a deprecated escape hatch we want to keep
	// behaving the same even if RawContextKey/getValue semantics shift later
	// (e.g. if getValue ever started falling back to the key's default). Reading
	// from the service directly pins the behavior, avoids fabricating a key whose
	// default no one reads, and needs no hide-flag to stay out of the registry.
	const { contextKeyService } = usePositronReactServicesContext();
	const [value, setValue] = useState<T | undefined>(() => contextKeyService.getContextKeyValue<T>(key));

	useEffect(() => {
		setValue(contextKeyService.getContextKeyValue<T>(key));

		const keys = new Set([key]);
		const disposable = contextKeyService.onDidChangeContext(e => {
			if (e.affectsSome(keys)) {
				setValue(contextKeyService.getContextKeyValue<T>(key));
			}
		});
		return () => disposable.dispose();
	}, [key, contextKeyService]);

	return value;
}
