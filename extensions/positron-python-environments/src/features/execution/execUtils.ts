export function quoteStringIfNecessary(arg: string): string {
    // Always return if already quoted to avoid double-quoting
    if (arg.startsWith('"') && arg.endsWith('"')) {
        return arg;
    }

    // Don't quote single shell operators/special characters
    if (arg.length === 1 && /[&|<>;()[\]{}$]/.test(arg)) {
        return arg;
    }

    // Quote if contains common shell special characters that are problematic across multiple shells
    // Includes: space, &, |, <, >, ;, ', ", `, (, ), [, ], {, }, $
    const needsQuoting = /[\s&|<>;'"`()\[\]{}$]/.test(arg);

    return needsQuoting ? `"${arg}"` : arg;
}

export function quoteArgs(args: string[]): string[] {
    return args.map(quoteStringIfNecessary);
}
