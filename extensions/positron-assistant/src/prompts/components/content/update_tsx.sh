#!/bin/bash

# List of files to update
files=(
    "EditorStreamingContent.tsx"
    "FilepathsContent.tsx"
    "FollowupsContent.tsx"
    "SelectionContent.tsx"
    "SelectionStreamingContent.tsx"
    "SessionsContent.tsx"
)

for file in "${files[@]}"; do
    echo "Updating $file..."

    # Remove PromptPiece import
    sed -i '' 's/PromptPiece,//' "$file"

    # Update render method signature
    sed -i '' 's/render(): PromptPiece {/render() {/' "$file"

    # Update return statement - this is more complex so we'll handle it case by case
    echo "Updated $file imports and render signature"
done

echo "Batch update complete. Manual fixes may be needed for render method bodies."
