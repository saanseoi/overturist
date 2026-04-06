#!/bin/bash

# Get the current branch
current_branch=$(git rev-parse --abbrev-ref HEAD)

# Check if we're trying to push to main
if [ "$current_branch" = "main" ]; then
  # Get the previous commit (what main was before this push)
  previous_commit=$(git rev-parse HEAD~1)
  
  # Check if this is a merge commit
  if git rev-parse --verify --quiet HEAD^2 > /dev/null; then
    # This is a merge commit, check the source branch
    # Get the merge commit message to extract source branch info
    merge_msg=$(git log --format=%B -n 1 HEAD)
    
    # Extract branch name from merge message (format: "Merge branch 'source-branch'")
    if echo "$merge_msg" | grep -q "Merge branch"; then
      source_branch=$(echo "$merge_msg" | sed -n "s/.*Merge branch '\([^']*\)'.*/\1/p")
      
      # Check if source branch is allowed
      if [ "$source_branch" != "preview" ] && [ "$source_branch" != "hotfix" ]; then
        echo "❌ Error: Merges to 'main' are only allowed from 'preview' or 'hotfix' branches."
        echo "   You tried to merge from: '$source_branch'"
        echo "   Allowed source branches: 'preview', 'hotfix'"
        exit 1
      fi
      
      echo "✅ Merge to main from '$source_branch' is allowed."
    fi
  else
    # Direct push to main (not a merge)
    echo "❌ Error: Direct pushes to 'main' are not allowed."
    echo "   Please create a pull request through 'preview' or 'hotfix' branch."
    exit 1
  fi
fi

exit 0 