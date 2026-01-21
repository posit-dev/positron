// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

// --- Start Positron ---
import { CommandsWithoutArgs, ICommandNameArgumentTypeMapping } from '../../../common/application/commands';
// --- End Positron ---
import { DiagnosticScope, IDiagnostic, IDiagnosticCommand } from '../types';

export type CommandOption<Type, Option> = { type: Type; options: Option };
type LaunchBrowserOption = CommandOption<'launch', string>;
type IgnoreDiagnosticOption = CommandOption<'ignore', DiagnosticScope>;
type ExecuteVSCCommandOption = CommandOption<'executeVSCCommand', CommandsWithoutArgs>;
// --- Start Positron ---
type ExecuteVSCCommandWithArgsOption = CommandOption<
    'executeVSCCommandWithArgs',
    { command: keyof ICommandNameArgumentTypeMapping; args: any[] }
>;
export type CommandOptions =
    | LaunchBrowserOption
    | IgnoreDiagnosticOption
    | ExecuteVSCCommandOption
    | ExecuteVSCCommandWithArgsOption;
// --- End Positron ---

export const IDiagnosticsCommandFactory = Symbol('IDiagnosticsCommandFactory');

export interface IDiagnosticsCommandFactory {
    createCommand(diagnostic: IDiagnostic, options: CommandOptions): IDiagnosticCommand;
}
