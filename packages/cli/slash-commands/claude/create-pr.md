# Create Pull Request

Create a pull request for the current branch using `gh pr create`.

## Before Creating the PR

1. **Check for branch context** - Ensure `.ragtime/branches/{branch}/context.md` exists
2. **Stage ragtime files** - Branch context should be committed with the PR

```bash
BRANCH=$(git branch --show-current)
BRANCH_SLUG=$(echo "$BRANCH" | tr '/' '-')

# Check for branch context
CONTEXT_FILE=".ragtime/branches/$BRANCH_SLUG/context.md"
if [ -f "$CONTEXT_FILE" ]; then
  echo "✓ Found branch context: $CONTEXT_FILE"
  git add "$CONTEXT_FILE"
else
  echo "⚠ No branch context found (consider running /handoff first)"
fi
```

## Include in the PR

- A clear title summarizing the changes
- Link to the related issue
- Summary of what was changed and why
- Any notes for reviewers

## Important

**Commit the branch context with your PR.** The `.ragtime/branches/{branch}/context.md` file contains the implementation plan and decisions - reviewers benefit from seeing this alongside the code changes.

$ARGUMENTS
