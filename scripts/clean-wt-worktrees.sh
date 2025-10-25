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
  if git worktree remove --force --quiet "$path" 2>/dev/null; then
    echo "  git worktree removed: $path"
  else
    echo "  git worktree remove failed or already removed: $path (continuing)" >&2
  fi

  # If directory still exists, try to remove it
  if [[ -d "$path" ]]; then
    echo "  removing leftover directory: $path"
    rm -rf -- "$path"
  fi

  # Delete local branch if it exists
  if git show-ref --verify --quiet "refs/heads/$br"; then
    echo "  deleting local branch: $br"
    if git branch -D "$br" >/dev/null 2>&1; then
      echo "  branch deleted: $br"
    else
      echo "  failed to delete branch: $br" >&2
    fi
  else
    echo "  local branch not found (skipping delete): $br"
  fi
done

echo "Done."
