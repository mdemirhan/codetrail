import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerZIP } from "@electron-forge/maker-zip";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";

const forgeConfig = {
  packagerConfig: {
    asar: true,
    name: "Code Trail",
    appBundleId: "com.codetrail.desktop",
  },
  rebuildConfig: {},
  plugins: [new AutoUnpackNativesPlugin({})],
  makers: [new MakerZIP({}, ["darwin"]), new MakerDMG({}, ["darwin"])],
};

export default forgeConfig;
