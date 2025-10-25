{
  description = "Bun2Nix minimal sample";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
    systems.url = "github:nix-systems/default";

    bun2nix.url = "github:baileyluTCD/bun2nix?tag=1.5.2";
    bun2nix.inputs.nixpkgs.follows = "nixpkgs";
    bun2nix.inputs.systems.follows = "systems";
  };

  # Use the cached version of bun2nix from the garnix cli
  nixConfig = {
    extra-substituters = [
      "https://cache.nixos.org"
      "https://cache.garnix.io"
    ];
    extra-trusted-public-keys = [
      "cache.nixos.org-1:6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY="
      "cache.garnix.io:CTFPyKSLcx5RMJKfLo5EEPUObbA78b0YQ2DTCJXqr9g="
    ];
  };

  outputs =
    {
      nixpkgs,
      systems,
      bun2nix,
      ...
    }:
    let
      eachSystem = nixpkgs.lib.genAttrs (import systems);
      pkgsFor = eachSystem (system: import nixpkgs { inherit system; });
    in
    {
      packages = eachSystem (system: {
        # Produce a package for this template with bun2nix
        default = pkgsFor.${system}.callPackage ./nix {
          inherit (bun2nix.lib.${system}) mkBunDerivation;
          src = ./.;
          bunNix = ./nix/bun.nix;
        };
      });

      devShells = eachSystem (system: {
        default = pkgsFor.${system}.mkShell {
          packages = with pkgsFor.${system}; [
            bun

            # Add the bun2nix binary to the devshell
            bun2nix.packages.${system}.default

            # Add the opencode wrapper
            (callPackage ./nix/opencode-wrapper.nix {
              oc = (
                callPackage ./nix {
                  inherit (bun2nix.lib.${system}) mkBunDerivation;
                  src = ./.;
                  bunNix = ./nix/bun.nix;
                }
              );
            })
          ];

          shellHook = ''
            bun install --frozen-lockfile
          '';
        };
      });
    };
}
