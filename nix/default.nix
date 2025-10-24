{
  mkBunDerivation,
  bunNix ? ./bun.nix,
  src,
  ...
}:

mkBunDerivation {
  pname = "minimal-bun2nix-example";
  version = "1.0.0";

  # should be the repository root
  src = src;

  # bun.nix sits next to this file in nix/
  bunNix = bunNix;

  index = "index.ts";
}
