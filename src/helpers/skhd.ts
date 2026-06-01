import { getPreferenceValues } from "@raycast/api";
import { execaCommand } from "execa";
import { existsSync } from "fs";
import { cpus } from "os";

const SKHD_BINARY_NAME = "skhd";
const HOMEBREW_SKHD_PATHS = ["/opt/homebrew/bin/skhd", "/usr/local/bin/skhd"];
const HOMEBREW_BIN_DIRS = ["/opt/homebrew/bin", "/usr/local/bin"];

function getDefaultSkhdPath() {
  return cpus()[0].model.includes("Apple") ? "/opt/homebrew/bin/skhd" : "/usr/local/bin/skhd";
}

function getSkhdLookupPath() {
  const pathEntries = process.env.PATH?.split(":").filter(Boolean) ?? [];
  return Array.from(new Set([...pathEntries, ...HOMEBREW_BIN_DIRS])).join(":");
}

function getExistingDefaultSkhdPath() {
  const paths = [getDefaultSkhdPath(), ...HOMEBREW_SKHD_PATHS];
  return Array.from(new Set(paths)).find((path) => existsSync(path));
}

export async function getSkhdPath() {
  const preferences = getPreferenceValues<Preferences>();
  const preferencePath = preferences.skhdPath?.trim();
  if (preferencePath) {
    return preferencePath;
  }

  const defaultPath = getExistingDefaultSkhdPath();
  if (defaultPath) {
    return defaultPath;
  }

  try {
    const { stdout } = await execaCommand(`command -v ${SKHD_BINARY_NAME}`, {
      env: {
        ...process.env,
        PATH: getSkhdLookupPath(),
      },
    });
    const candidate = stdout.trim();
    return candidate || undefined;
  } catch (_error) {
    return undefined;
  }
}
