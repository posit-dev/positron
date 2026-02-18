# Positron Python Extension

Python language support for the Positron IDE. Fork of Microsoft's Python extension with data science enhancements.

## Project Structure

- `src/` - TypeScript extension code
- `python_files/posit/positron/` - Python kernel extending ipykernel
- `python_files/posit/positron/tests/` - Python kernel unit tests
- `python_files/posit/positron/_vendor/` - Vendored Python kernel dependencies
- `python_files/lib/` - Dependencies bundled with the extension
- `build/` - Build configurations

## Code Style

- In this extension, use 4 spaces for indentation in TypeScript/JavaScript, not tabs. (This is different from the rest of the repository!)
- Never use em-dashes, en-dashes, smart quotes, or other non-ASCII punctuation. Use ASCII hyphens and straight quotes

## Testing

- Before running commands, if a virtual environment exists at `extensions/positron-python/.venv`, activate it
- **Python**: Run pytest from `extensions/positron-python/python_files/posit`
- **TypeScript**: `npm run test-extension -- -l positron-python --grep "pattern"`
- Never use `if __name__ == "__main__"` in test files
- Use parametrized tests (`@pytest.mark.parametrize`) for comprehensive coverage

## Code Quality

- Before running commands, if a virtual environment exists at `extensions/positron-python/.venv`, activate it
- **Check Python**: `./scripts/check-python-quality.sh`
- **Fix Python**: `./scripts/fix-python-format.sh`
- **Check TypeScript**: `npm run format-check`
- **Fix TypeScript**: `npm run format-fix`

## Optional Dependencies

Use graceful degradation for optional dependencies:

```python
try:
    import optional_library
    HAS_OPTIONAL = True
except ImportError:
    HAS_OPTIONAL = False

def enhanced_function(data):
    if HAS_OPTIONAL:
        return optional_library.process(data)
    return fallback_implementation(data)
```
