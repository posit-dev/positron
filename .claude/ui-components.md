# Positron UI Components Context

This prompt provides context for working with Positron's reusable UI components, patterns, and styling conventions.

## Finding Existing Components

Always search before creating new UI controls:

```bash
# Find React components in Positron directories
Glob: **/positron**/components/*.tsx
Glob: **/positronComponents/**/*.tsx

# Search for specific control types
Grep: "toggle" --glob "*.tsx" --glob "*positron*"
Grep: "ScreenReaderOnly" --type tsx
Grep: "Modal" --glob "*positron*.tsx"
```

## Component Categories

### Action Bar Controls
Search: `Glob: **/positronActionBar/**/components/*.tsx`

Toolbar controls like buttons, toggles, filters, and menu triggers.

**Context Requirement:** Action bar components use `useRegisterWithActionBar` hook requiring `PositronActionBarContext`. They cannot be used directly in modals or dialogs—search for the CSS patterns and copy styling instead.

### Base UI Primitives
Search: `Glob: **/positronComponents/**/*.tsx`

Low-level reusable primitives including buttons, accessibility helpers (`ScreenReaderOnly`), splitters, and progress indicators.

### Modal and Popup Components
Search: `Grep: "positronModal" --type tsx`

Dialog and popover frameworks. Look for `ModalDialog` and `ModalPopup` patterns.

## CSS Patterns

### Conditional Class Names
Search for `positronClassNames` usage:
```typescript
import { positronClassNames } from 'vs/base/common/positronUtilities';

const className = positronClassNames(
    'base-class',
    { 'active': isActive, 'disabled': isDisabled }
);
```

### Accessibility: Visually Hidden Inputs
For custom controls needing hidden native inputs, search for `ScreenReaderOnly` or use this CSS pattern:

```css
.visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
}
```

### Finding CSS Patterns
```bash
# Search for similar styling patterns
Grep: "\.toggle" --glob "*.css" --glob "*positron*"
Grep: "\.button" --glob "*.css" --glob "*positron*"
```

## Common Patterns

### Modal Dialogs
Search: `Grep: "positronModalDialog" --type tsx`

Look for existing modal implementations to understand the framework pattern.

### Action Bar Integration
1. Search for `PositronActionBarContextProvider` to check if parent provides context
2. If context available, reuse action bar components
3. If no context (e.g., in modals), copy CSS patterns from action bar stylesheets

### Feature-Specific Components
Each Positron feature has its own components directory. Search by feature name:
```bash
Glob: **/positronDataExplorer/**/components/*.tsx
Glob: **/positronVariables/**/components/*.tsx
Glob: **/positronPlots/**/components/*.tsx
Glob: **/positronConsole/**/components/*.tsx
```

## Tips

1. **Search before creating**: Many controls already exist in slightly different forms
2. **Copy CSS, not components**: When context requirements prevent component reuse
3. **Check similar features**: Look at how other Positron features implement similar UI
4. **Use semantic HTML**: Prefer native elements with custom styling over div soup
5. **Follow naming conventions**: Positron components use `positron` prefix in directory and file names
