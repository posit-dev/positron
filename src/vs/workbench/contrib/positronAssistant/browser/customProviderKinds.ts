/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';

/**
 * A `providers.custom` entry's type, which also carries the wire format: an
 * `anthropic` entry speaks Anthropic Messages. There is no separate API type
 * field, here or in the form.
 *
 * These are the kinds Positron can both authenticate and collect every
 * connection field for. The rest of ai-config's kinds need a field the modal
 * can't ask for yet (an AWS profile, a Snowflake home, a GCP project), and an
 * entry without it either can't reach an account of its own or resolves the
 * same ambient credential as its built-in counterpart. They arrive as the form
 * grows. The extension keeps the matching list in `customProviderAuth.ts`
 * (`isOfferedCustomKind`), which decides what gets registered; this table is
 * what the picker shows.
 */
export type CustomProviderKind = 'openai-compatible' | 'anthropic' | 'openai';

/** How the type picker groups the kinds. */
export type CustomProviderGroup = 'gateways' | 'cloud' | 'local';

export interface CustomProviderKindPolicy {
	/** Vendor name shown in the picker. A proper noun, so not localized. */
	readonly label: string;
	readonly group: CustomProviderGroup;
	/**
	 * The built-in provider whose connection fields a custom entry of this kind
	 * reuses. A custom Anthropic entry asks for what the Anthropic tile asks
	 * for, read from that source's own `supportedOptions` rather than restated
	 * here, so a field added to the tile shows up on custom entries too. The
	 * extension keeps the other half of this mapping in `BUILTIN_FORM_BY_KIND`.
	 */
	readonly fieldsFrom: string;
}

/**
 * Every offered kind, exhaustively: adding one to {@link CustomProviderKind}
 * fails to compile until the UI decides on its label, group, and which
 * built-in form it borrows.
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

/**
 * The one-line description of a custom entry, which says which kind it is so
 * two entries of different types are told apart at a glance.
 */
export function customProviderDescription(kind: CustomProviderKind): string {
	return localize(
		'positron.customProviderKinds.description',
		"Custom {0} provider",
		CUSTOM_PROVIDER_KINDS[kind].label
	);
}
