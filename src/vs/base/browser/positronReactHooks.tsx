/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { usePositronReactServicesContext } from './positronReactRendererContext.js';
import { ContextKeyValue, IContextKeyService, RawContextKey } from '../../platform/contextkey/common/contextkey.js';
import { ExtensionIdentifier } from '../../platform/extensions/common/extensions.js';


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
