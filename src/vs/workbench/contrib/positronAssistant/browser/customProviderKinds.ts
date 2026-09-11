/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { IPositronProviderMetadata } from '../common/interfaces/positronAssistantService.js';

/**
 * A `providers.custom` entry's type, which also carries the wire format: an
 * `anthropic` entry speaks Anthropic Messages, so there is no separate API type
 * field. These are the kinds Positron can authenticate and collect every
 * connection field for; the rest arrive as the form grows. This table is what
 * the picker shows; `isOfferedCustomKind` in the extension is what registers.
 */
export type CustomProviderKind = 'openai-compatible' | 'anthropic' | 'openai';

/** How the type picker groups the kinds. */
export type CustomProviderGroup = 'gateways' | 'cloud' | 'local';

export interface CustomProviderKindPolicy {
	/** Vendor name shown in the picker. A proper noun, so not localized. */
	readonly label: string;
	readonly group: CustomProviderGroup;
	/**
	 * The built-in whose connection fields this kind reuses, read from that
	 * source's own `supportedOptions` so the two can't drift.
	 */
	readonly fieldsFrom: string;
}

/**
 * Every offered kind, exhaustively: adding one to {@link CustomProviderKind}
 * fails to compile until it has a label, a group, and a form to borrow.
 */
export const CUSTOM_PROVIDER_KINDS = {
	'openai-compatible': { label: 'OpenAI Compatible', group: 'gateways', fieldsFrom: 'openai-compatible' },
	anthropic: { label: 'Anthropic', group: 'cloud', fieldsFrom: 'anthropic-api' },
	openai: { label: 'OpenAI', group: 'cloud', fieldsFrom: 'openai-api' },
} as const satisfies Record<CustomProviderKind, CustomProviderKindPolicy>;

/** The kind the Add form opens on: any endpoint that speaks OpenAI chat. */
export const DEFAULT_CUSTOM_PROVIDER_KIND: CustomProviderKind = 'openai-compatible';

/**
 * Group order in the picker. `local` has no kinds yet (ollama and lmstudio
 * arrive with the endpoint field); an empty group renders nothing.
 */
export const CUSTOM_PROVIDER_GROUP_ORDER: readonly CustomProviderGroup[] = ['gateways', 'cloud', 'local'];

/** Heading shown above a group's kinds in the picker. */
export function customProviderGroupLabel(group: CustomProviderGroup): string {
	switch (group) {
		case 'gateways':
			return localize('positron.customProviderKinds.group.gateways', "Gateways");
		case 'cloud':
			return localize('positron.customProviderKinds.group.cloud', "Cloud Providers");
		case 'local':
			return localize('positron.customProviderKinds.group.local', "Local Providers");
	}
}

/** The kinds in a group, in declaration order. */
export function customProviderKindsInGroup(group: CustomProviderGroup): CustomProviderKind[] {
	return (Object.keys(CUSTOM_PROVIDER_KINDS) as CustomProviderKind[])
		.filter(kind => CUSTOM_PROVIDER_KINDS[kind].group === group);
}

/** Whether Positron's picker offers this kind. */
export function isOfferedCustomProviderKind(kind: string): kind is CustomProviderKind {
	return kind in CUSTOM_PROVIDER_KINDS;
}

/** The row's one-line description, which names the kind. */
export function customProviderDescription(kind: CustomProviderKind): string {
	return localize(
		'positron.customProviderKinds.description',
		"Custom {0} provider",
		CUSTOM_PROVIDER_KINDS[kind].label
	);
}

/**
 * The provider whose icon and field labels a source shows: its own, or, for a
 * custom entry, the built-in its type borrows from. Falls back to the entry's
 * own id (and the generic icon) for a kind Positron doesn't offer.
 */
export function providerIconId(provider: IPositronProviderMetadata): string {
	const kind = provider.customKind;
	return kind && isOfferedCustomProviderKind(kind)
		? CUSTOM_PROVIDER_KINDS[kind].fieldsFrom
		: provider.id;
}
