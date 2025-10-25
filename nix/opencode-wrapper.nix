{ writeShellScriptBin, oc }:

writeShellScriptBin "oc" ''
  find_user_opencode() {
    for profile in $NIX_PROFILES; do
      if [ -x "$profile/bin/opencode" ]; then
        echo "$profile/bin/opencode"
        return 0
      fi
    done
    return 1
  }

  user_opencode=$(find_user_opencode)
  if [ $? -eq 0 ]; then
    if [ -f ".opencode/config.json" ]; then
      exec env OPENCODE_CONFIG=.opencode/config.json "$user_opencode" "$@"
    else
      exec "$user_opencode" "$@"
    fi
  else
    echo "Error: Could not find user's opencode binary in NIX_PROFILES" >&2
    exit 1
  fi
''
