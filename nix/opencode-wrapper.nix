{ writeShellScriptBin, opencode }:

writeShellScriptBin "opencode" ''
  if [ -f ".opencode/config.json" ]; then
    export OPENCODE_CONFIG=".opencode/config.json"
  fi
  exec ${opencode}/bin/opencode "$@"
''