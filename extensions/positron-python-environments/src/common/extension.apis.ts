/* eslint-disable @typescript-eslint/no-explicit-any */
import { Extension, extensions } from 'vscode';

export function getExtension<T = any>(extensionId: string): Extension<T> | undefined {
    return extensions.getExtension(extensionId);
}

export function allExtensions(): readonly Extension<any>[] {
    return extensions.all;
}
