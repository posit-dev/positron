/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { usePositronReactServicesContext } from './positronReactRendererContext.js';
import { ContextKeyValue, IContextKeyService } from '../../platform/contextkey/common/contextkey.js';
import { ExtensionIdentifier } from '../../platform/extensions/common/extensions.js';


/**
 * usePositronConfiguration hook.
 * @param key Configuration key to retrieve.
 * @param watch Whether to watch for changes. Default true.
 * @returns The configuration value.
 */
export const usePositronConfiguration = <T,>(key: string, watch: boolean = true): T => {
	const { configurationService } = usePositronReactServicesContext();
	const [value, setValue] = useState(() => configurationService.getValue<T>(key));

	useEffect(() => {
		if (!watch) {
			return;
		}
		const disposable = configurationService.onDidChangeConfiguration(e => {
			e.affectsConfiguration(key) && setValue(configurationService.getValue<T>(key));
		});
		return () => disposable.dispose();
	}, [configurationService, key, watch]);

	return value;
}

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
 * usePositronContextKey hook.
 * @param key Context key to retrieve.
 * @param watch Whether to watch for changes. Default true.
 * @param service The context key service to observe. Defaults to the service
 *   from the React services context. Pass a scoped service (e.g. an editor's
 *   `scopedContextKeyService`) to observe keys set on that scope.
 * @returns The context value.
 */
export const usePositronContextKey = <T extends ContextKeyValue,>(key: string, watch: boolean = true, service?: IContextKeyService): T | undefined => {
	// Always read the context unconditionally to satisfy the rules of hooks; the
	// `service` override (e.g. an editor's scoped service) wins when provided.
	const defaultContextKeyService = usePositronReactServicesContext().contextKeyService;
	const contextKeyService = service ?? defaultContextKeyService;
	const [value, setValue] = useState(() => contextKeyService.getContextKeyValue<T>(key));

	useEffect(() => {
		if (!watch) {
			return;
		}
		const disposable = contextKeyService.onDidChangeContext(e => {
			const keySet = new Set([key]);
			e.affectsSome(keySet) && setValue(contextKeyService.getContextKeyValue<T>(key));
		});
		return () => disposable.dispose();
	}, [contextKeyService, key, watch]);

	return value;
}
