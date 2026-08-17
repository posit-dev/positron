---
paths:
  - src/**/*.tsx
---

# Positron React Patterns

Conventions for React components in `src/vs/`. Add new React-specific guidance to this file.

## useState initializers must be lazy

React evaluates an eager `useState(...)` argument on every render and discards the result after mount. Any initializer that computes something (calls a function, reads a service, constructs an object) must use the lazy form:

```tsx
// Wrong: runs on every render, result thrown away after mount
const [width, setWidth] = useState(computeWidth(services.configurationService));
const [id] = useState(generateUuid());

// Right: runs once at mount
const [width, setWidth] = useState(() => computeWidth(services.configurationService));
const [id] = useState(() => generateUuid());
```

The `local/code-no-eager-usestate` eslint rule enforces this, including calls nested inside the initializer expression, and its `--fix` applies the wrap. The eager form amplified posit-dev/positron#15427: components rendered per data grid cell each re-read configuration on every render.

A lazy initializer runs once, so a value that must track later changes needs a subscription in `useEffect` (for example `onDidChangeConfiguration`) that calls the setter. For configuration values, prefer the `usePositronConfiguration` hook in `src/vs/base/browser/positronReactHooks.tsx`, which does both.

## Related

- Lists, tables, grids, and `DataGridInstance`: use the `positron-data-grid-pattern` skill.
