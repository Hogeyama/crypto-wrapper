{
  description = "Profile-driven wrapper that runs existing CLIs through gocryptfs, keeping plaintext credentials safely encrypted.";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forEachSystem = nixpkgs.lib.genAttrs systems;
    in
    {
      packages = forEachSystem
        (system:
          let
            pkgs = import nixpkgs { inherit system; };
            srcDir = pkgs.symlinkJoin {
              name = "cryptow-src";
              paths = [ ./src ];
            };
          in
          rec {
            default = cryptow;
            cryptow =
              (pkgs.writeShellScriptBin "cryptow" ''
                exec ${pkgs.deno}/bin/deno run \
                  --allow-net \
                  --allow-env \
                  --allow-read \
                  --allow-write \
                  --config ${./deno.json} \
                  --lock ${./deno.lock} \
                  --frozen \
                  ${srcDir}/main.ts "$@"
              '').overrideAttrs (_: {
                meta = with pkgs.lib; {
                  description = "Profile-driven wrapper that runs existing CLIs through gocryptfs, keeping plaintext credentials safely encrypted.";
                  homepage = "https://github.com/hogeyama/cryptow";
                  license = licenses.mit;
                  platforms = platforms.linux;
                  mainProgram = "cryptow";
                };
              });
          });

      devShells = forEachSystem
        (system:
          let
            pkgs = import nixpkgs { inherit system; };
          in
          {
            default = pkgs.mkShell {
              buildInputs = [ pkgs.deno ];
            };
          });
    };
}
