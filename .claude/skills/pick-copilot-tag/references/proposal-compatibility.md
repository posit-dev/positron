# API Proposal Version Compatibility

## How the check works

VS Code extensions can use "proposed APIs" -- unstable APIs not yet finalized.
Each proposal can optionally carry a version number (e.g., `chatProvider@4`).

Positron's `product.json` contains an `extensionsEnabledWithApiProposalVersion`
list. Extensions on this list get **strict version enforcement**: every versioned
proposal in the extension's `package.json` must exactly match the version
compiled into the Positron build.

- Dev builds (`quality: null`) skip this check entirely
- Release builds enforce it -- mismatches block extension activation

## What causes failures

1. **New proposal added upstream** -- e.g., `chatHooks@6` added in v0.37.6,
   but Positron doesn't have `chatHooks` at all
2. **Version bumped upstream** -- e.g., `chatParticipantPrivate@12` -> `@13`,
   but Positron still has `@12`

Both produce the same error:
```
ERR: This extension is using the API proposals 'X' and 'Y'
that are not compatible with the current version of VS Code.
```

## Where proposals live

- **In the extension**: `package.json` -> `enabledApiProposals` array
- **In Positron**: compiled into `sharedProcessMain.js` (extracted at build time
  from `src/vs/platform/extensions/common/extensionsApiProposals.ts`)
- **In product.json**: `extensionsEnabledWithApiProposalVersion` controls which
  extensions get the strict check

## Why engine version isn't enough

Engine version match is necessary but not sufficient. There are two ways it
can mislead:

1. **Within a series**: All tags in a minor series (e.g., v0.37.0 through
   v0.37.9) target the same `engines.vscode` range (e.g., `^1.109.0`). But
   Microsoft cherry-picks features into release branches between patches, and
   those features can introduce new proposals or bump existing ones.

2. **Across series**: Multiple minor series can target the same engine range.
   For example, both v0.37.x and v0.38.x targeted `^1.109.0`, but v0.38 used
   proposals (`chatHooks`, bumped `chatParticipantPrivate`) from a pre-release
   VS Code that didn't exist in the stable 1.109 base. See
   posit-dev/positron-copilot-chat#15 for the full story.

The only reliable check is comparing the `enabledApiProposals` arrays.
