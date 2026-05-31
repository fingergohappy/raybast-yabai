import { getPreferenceValues, showToast, Toast } from "@raycast/api";
import { execa } from "execa";
import { homedir, userInfo } from "os";
import { cpus } from "os";
import fs from "fs";

const userEnv = {
  USER: userInfo().username,
};

export const runYabaiCommand = async (command: string, opt?: { shell?: boolean }) => {
  const preferences = getPreferenceValues<Preferences>();
  const yabaiPath: string =
    preferences.yabaiPath && preferences.yabaiPath.length > 0
      ? preferences.yabaiPath
      : cpus()[0].model.includes("Apple")
        ? "/opt/homebrew/bin/yabai"
        : "/usr/local/bin/yabai";

  if (!fs.existsSync(yabaiPath)) {
    await showToast(Toast.Style.Failure, "Yabai executable not found", `Is yabai installed at ${yabaiPath}?`);
    return { stdout: "", stderr: "Yabai executable not found" };
  }

  const normalizedCommand = command.trim();
  const args = normalizedCommand.split(/\s+/).filter(Boolean);
  return await execa(yabaiPath, args, {
    ...opt,
    env: {
      ...process.env,
      ...userEnv,
      HOME: homedir(),
    },
  });
};
