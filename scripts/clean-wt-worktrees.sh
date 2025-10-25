#!/usr/bin/env bash
set -euo pipefail

# clean-wt-worktrees.sh
# Find git worktrees whose branch name starts with `wt/`, remove the worktree
# and delete the corresponding local branch. By default this script prints a
# dry-run. Pass -y or --yes to actually perform deletions.

usage() {
  cat <<EOF
Usage: $(basename "$0") [-y|--yes]

By default this prints the worktrees and branches that would be removed.
Pass -y or --yes to actually remove worktrees and delete the local branches.
EOF
}

DO_IT=0

while [[ ${#} -gt 0 ]]; do
  case "$1" in
    -y|--yes)
      DO_IT=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      usage
      exit 2
      ;;
  esac
done

# ensure inside a git repository
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "Not a git repository (or no git available)." >&2
  exit 2
fi

declare -a targets=()

# Parse porcelain output which yields blocks like:
# worktree <path>
# HEAD <sha>
# branch refs/heads/wt/foo
#
# We'll collect entries where branch starts with refs/heads/wt/ or short 'wt/'.

current_path=""
current_branch=""

while IFS= read -r line; do
  if [[ $line == worktree\ * ]]; then
    current_path=${line#worktree }
    current_branch=""
  elif [[ $line == branch\ * ]]; then
    # porcelain reports full ref (e.g. refs/heads/wt/foo)
    current_branch=${line#branch }
  elif [[ -z $line ]]; then
    # block end
    if [[ -n $current_path && -n $current_branch ]]; then
      # normalize short name
      if [[ $current_branch == refs/heads/* ]]; then
        short=${current_branch#refs/heads/}
      else
        short=$current_branch
      fi
      if [[ $short == wt/* ]]; then
        targets+=("$current_path::${short}")
      fi
    fi
    current_path=""
    current_branch=""
  fi
done < <(git worktree list --porcelain)

# If last block had no trailing blank line, handle it
if [[ -n $current_path && -n $current_branch ]]; then
  if [[ $current_branch == refs/heads/* ]]; then
    short=${current_branch#refs/heads/}
  else
    short=$current_branch
  fi
  if [[ $short == wt/* ]]; then
    targets+=("$current_path::${short}")
  fi
fi

if [[ ${#targets[@]} -eq 0 ]]; then
  echo "No worktrees found for branches matching 'wt/*'."
  exit 0
fi

echo "Found ${#targets[@]} matching worktree(s):"
for t in "${targets[@]}"; do
  path=${t%%::*}
  br=${t##*::}
  echo " - worktree at: $path  branch: $br"
done

if [[ $DO_IT -ne 1 ]]; then
  echo
  echo "DRY-RUN: No changes made. Rerun with -y or --yes to delete these worktrees and branches."
  exit 0
fi

echo
echo "Proceeding to remove worktrees and delete local branches..."

for t in "${targets[@]}"; do
  path=${t%%::*}
  br=${t##*::}

  echo "Removing worktree at: $path"

  # If the worktree directory exists, ensure it is not currently on the
  # branch we're about to delete. If it is, attempt to check out a safe
  # branch (prefer 'main' or 'master') or detach HEAD. This allows branch
  # deletion later without being blocked by a checked-out branch.
  if [[ -d "$path" ]]; then
    current_in_worktree=$(git -C "$path" symbolic-ref --quiet --short HEAD 2>/dev/null || true)
    if [[ -n "$current_in_worktree" && "$current_in_worktree" == "$br" ]]; then
      echo "  worktree $path currently on branch $br; switching to safe ref"
      if git show-ref --verify --quiet refs/heads/main; then
        git -C "$path" checkout main >/dev/null 2>&1 || true
        echo "  checked out 'main' in $path"
      elif git show-ref --verify --quiet refs/heads/master; then
        git -C "$path" checkout master >/dev/null 2>&1 || true
        echo "  checked out 'master' in $path"
      else
        git -C "$path" checkout --detach >/dev/null 2>&1 || true
        echo "  detached HEAD in $path"
      fi
    fi
  fi

  # Try to remove the worktree without --force first so git can perform a
  # clean detach. If that fails, retry with --force as a fallback.
  if git worktree remove --quiet "$path" 2>/dev/null; then
    echo "  git worktree removed: $path"
  else
    echo "  git worktree remove failed (retrying with --force)"
    if git worktree remove --force --quiet "$path" 2>/dev/null; then
      echo "  git worktree force-removed: $path"
    else
      echo "  git worktree remove failed or already removed: $path (continuing)" >&2
    fi
  fi

  # If directory still exists, try to remove it
  if [[ -d "$path" ]]; then
    echo "  removing leftover directory: $path"
    rm -rf -- "$path"
  fi

  # Delete local branch if it exists. If `git branch -D` fails (for
  # example because the branch is still checked out somewhere), attempt a
  # lower-level removal with update-ref as a last resort.
  if git show-ref --verify --quiet "refs/heads/$br"; then
    echo "  deleting local branch: $br"
    if git branch -D "$br" >/dev/null 2>&1; then
      echo "  branch deleted: $br"
    else
      echo "  failed to delete branch: $br (attempting force removal of ref)" >&2
      if git update-ref -d "refs/heads/$br" >/dev/null 2>&1; then
        echo "  branch force-removed via update-ref: $br"
      else
        echo "  failed to force-remove branch $br" >&2
      fi
    fi
  else
    echo "  local branch not found (skipping delete): $br"
  fi

  # Prune stale worktrees
  git worktree prune --quiet
done

echo "Done."
