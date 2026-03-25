import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";

const forgeConfig = {
  packagerConfig: {
    asar: true,
    name: "Code Trail",
    appBundleId: "com.codetrail.desktop",
    executableName: "CodeTrail",
    icon: "./assets/icons/build/codetrail",
  },
  rebuildConfig: {},
  plugins: [new AutoUnpackNativesPlugin({})],
  makers: [
    new MakerZIP({}, ["darwin"]),
    new MakerDMG({}, ["darwin"]),
    new MakerSquirrel({
      name: "codetrail",
      setupExe: "CodeTrailSetup.exe",
      setupIcon: "./assets/icons/build/codetrail.ico",
    }),
    new MakerZIP({}, ["win32"]),
  ],
};

export default forgeConfig;
