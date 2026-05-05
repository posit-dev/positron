# Positron Configuration

The configuration contribution point powers settings exposed to users via the Settings editor or `settings.json`. Follow these conventions when adding or modifying entries.

## Don't repeat what users already know

Every entry in the configuration contribution point is a Positron setting. Terms like "Positron", "Setting", "Extension", or "Configuration" add no information for the user.

**Titles and display names:**
- "Kernel Supervisor", not "Positron Kernel Supervisor Settings"

**Setting keys** (the public name in `settings.json`): use a topical namespace, not a `positron.` prefix.

```ts
// Wrong
properties: {
    'positron.startupDiagnostics.timeout': { ... }
}

// Right
properties: {
    'startupDiagnostics.timeout': { ... }
}
```

## Avoid non-letter characters in titles and setting names

Punctuation can render awkwardly in the Settings editor. Prefer "Remote SSH" over "Remote - SSH".

## Use the `order` field when order matters

The Settings editor sorts settings lexicographically by default, not by manifest order. Set the `order` field explicitly when a specific grouping or sequence is important.

## localize() IDs are the exception: keep the `positron.` prefix

The first argument to `nls.localize(...)` is not user-facing. It is an internal lookup key the localization tooling uses to find strings. Use a `positron.` prefix so Positron-introduced strings stay scoped and findable, distinct from upstream VS Code strings.

```ts
properties: {
    'startupDiagnostics.timeout': {
        description: localize(
            'positron.startupDiagnostics.timeout',
            "Timeout in milliseconds for startup diagnostics."
        )
    }
}
```

The setting key is bare; the localize ID is prefixed. They look almost identical, but they serve different audiences (user-facing vs tooling-facing).
