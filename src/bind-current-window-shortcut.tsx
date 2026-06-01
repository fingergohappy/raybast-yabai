import {
  Action,
  ActionPanel,
  Alert,
  closeMainWindow,
  confirmAlert,
  List,
  PopToRootType,
  showHUD,
  showToast,
  Toast,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { execa } from "execa";
import { mkdir, readFile, writeFile } from "fs/promises";
import { homedir, userInfo } from "os";
import { join } from "path";
import { useEffect, useState } from "react";
import { getSkhdPath } from "./helpers/skhd";
import { runYabaiCommand } from "./helpers/scripts";
import { IWindow } from "./types/yabai";

interface WindowShortcutBinding {
  shortcut: string;
  windowId: number;
}

const SKHD_CONFIG_DIR = join(homedir(), ".config", "skhd");
const SKHD_SHORTCUT_FILE = join(SKHD_CONFIG_DIR, "window_shortcut_skhdrc");
const FOCUS_WINDOW_SCRIPT = "~/.config/skhd/focus_window.sh";
const SKHD_MODIFIER = "alt";

function normalizeShortcut(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .slice(0, 1);
}

function parseWindowShortcutLine(line: string): WindowShortcutBinding | null {
  const match = line.trim().match(/^alt\s*-\s*([a-zA-Z])\s*:\s*.*\bfocus_window\.sh\s+(\d+)\s*$/);
  if (!match) {
    return null;
  }

  return {
    shortcut: match[1].toLowerCase(),
    windowId: Number(match[2]),
  };
}

async function loadSkhdWindowShortcuts(): Promise<WindowShortcutBinding[]> {
  try {
    const fileContent = await readFile(SKHD_SHORTCUT_FILE, "utf8");
    return fileContent
      .split(/\r?\n/)
      .map((line) => parseWindowShortcutLine(line))
      .filter((item): item is WindowShortcutBinding => item !== null);
  } catch (_error) {
    return [];
  }
}

async function executeSkhd(args: string[]) {
  const skhdPath = await getSkhdPath();
  if (!skhdPath) {
    throw new Error("skhd executable not found");
  }

  return execa(skhdPath, args, {
    env: {
      ...process.env,
      USER: userInfo().username,
      HOME: homedir(),
    },
  });
}

async function reloadSkhd() {
  try {
    await executeSkhd(["--reload"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("pid-file")) {
      await executeSkhd(["--restart-service"]);
      return;
    }

    throw error;
  }
}

async function bindWindowShortcut(windowId: number, shortcut: string) {
  const normalizedShortcut = normalizeShortcut(shortcut);
  await mkdir(SKHD_CONFIG_DIR, { recursive: true });
  const currentContent = await readFile(SKHD_SHORTCUT_FILE, "utf8").catch(() => "");
  const bindingLine = `${SKHD_MODIFIER} - ${normalizedShortcut} : ${FOCUS_WINDOW_SCRIPT} ${windowId}`;
  const keepLines = currentContent
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .filter((line) => {
      const parsed = parseWindowShortcutLine(line);
      if (!parsed) {
        return true;
      }

      return parsed.shortcut !== normalizedShortcut && parsed.windowId !== windowId;
    });

  keepLines.push(bindingLine);
  await writeFile(SKHD_SHORTCUT_FILE, `${keepLines.join("\n")}\n`, "utf8");
  await reloadSkhd();
}

async function fetchCurrentWindow(): Promise<IWindow> {
  const { stderr, stdout } = await runYabaiCommand("-m query --windows --window");
  if (stderr) {
    throw new Error(stderr);
  }

  return JSON.parse(stdout) as IWindow;
}

async function fetchWindows(): Promise<IWindow[]> {
  const { stderr, stdout } = await runYabaiCommand("-m query --windows");
  if (stderr) {
    throw new Error(stderr);
  }

  return JSON.parse(stdout) as IWindow[];
}

async function checkShortcutConflict(windowId: number, shortcut: string, existingWindowIds: ReadonlySet<number>) {
  const bindings = await loadSkhdWindowShortcuts();
  const conflict = bindings.find((item) => {
    if (item.shortcut !== shortcut) {
      return false;
    }

    return item.windowId === windowId || existingWindowIds.has(item.windowId);
  });
  if (!conflict) {
    return { exists: false, ownerId: undefined, sameWindow: false };
  }

  return {
    exists: true,
    ownerId: conflict.windowId,
    sameWindow: conflict.windowId === windowId,
  };
}

function getWindowLabelById(windowId: number, windows: IWindow[]) {
  const window = windows.find((item) => item.id === windowId);
  if (!window) {
    return `window ${windowId}`;
  }

  const title = (window.title || "").trim();
  if (!title) {
    return window.app;
  }

  return `${window.app} (${window.title})`;
}

async function confirmShortcutReplacement(shortcut: string, ownerLabel: string) {
  return new Promise<boolean>((resolve) => {
    confirmAlert({
      title: "Shortcut already bound",
      message: `alt+${shortcut} 已经绑定到 ${ownerLabel}，是否替换该绑定？`,
      primaryAction: {
        title: "替换",
        style: Alert.ActionStyle.Destructive,
        onAction: () => resolve(true),
      },
      dismissAction: {
        title: "取消",
        onAction: () => resolve(false),
      },
    });
  });
}

export default function Command() {
  const [shortcut, setShortcut] = useState("");
  const [existingShortcut, setExistingShortcut] = useState<string>();
  const { data: currentWindow, isLoading } = usePromise(fetchCurrentWindow);

  useEffect(() => {
    if (!currentWindow) {
      return;
    }

    let isCancelled = false;

    async function loadExistingShortcut() {
      const bindings = await loadSkhdWindowShortcuts();
      if (isCancelled || !currentWindow) {
        return;
      }

      const currentBinding = bindings.find((item) => item.windowId === currentWindow.id)?.shortcut;
      setExistingShortcut(currentBinding);
      if (currentBinding) {
        setShortcut((value) => value || currentBinding);
      }
    }

    loadExistingShortcut();

    return () => {
      isCancelled = true;
    };
  }, [currentWindow]);

  async function showSuccess(message: string) {
    await closeMainWindow({
      clearRootSearch: true,
      popToRootType: PopToRootType.Immediate,
    });
    await showHUD(message);
  }

  async function handleSubmit() {
    if (!currentWindow) {
      await showToast(Toast.Style.Failure, "No focused window", "Cannot get current window");
      return;
    }

    const pressedKey = normalizeShortcut(shortcut);
    if (!/^[a-z]$/.test(pressedKey)) {
      await showToast(Toast.Style.Failure, "Invalid shortcut", "Please input a single letter (a-z)");
      return;
    }

    try {
      const allWindows = await fetchWindows();
      const existingWindowIds = new Set(allWindows.map((window) => window.id));
      const conflict = await checkShortcutConflict(currentWindow.id, pressedKey, existingWindowIds);
      if (conflict.exists) {
        if (conflict.sameWindow) {
          await showSuccess(`alt+${pressedKey} is already bound to this window`);
          return;
        }

        const ownerLabel =
          typeof conflict.ownerId === "number" ? getWindowLabelById(conflict.ownerId, allWindows) : "unknown window";
        const shouldReplace = await confirmShortcutReplacement(pressedKey, ownerLabel);
        if (!shouldReplace) {
          return;
        }
      }

      await bindWindowShortcut(currentWindow.id, pressedKey);
      await showSuccess(`${currentWindow.app}: ${currentWindow.title} -> alt+${pressedKey}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      await showToast(Toast.Style.Failure, "Failed to bind shortcut", message);
    }
  }

  const pressedKey = normalizeShortcut(shortcut);
  const title =
    existingShortcut && pressedKey === existingShortcut
      ? `Current binding: alt+${existingShortcut}`
      : pressedKey
        ? `Bind alt+${pressedKey}`
        : "Input a letter to bind";
  const windowTitle = currentWindow?.title ? `${currentWindow.app} (${currentWindow.title})` : currentWindow?.app;

  return (
    <List
      isLoading={isLoading}
      navigationTitle={`Bind Shortcut for ${currentWindow?.app ?? "Current Window"}`}
      searchBarPlaceholder="输入一个字母（a-z），按 Enter 绑定为 alt+该字母"
      searchText={shortcut}
      onSearchTextChange={(value) => setShortcut(normalizeShortcut(value))}
      filtering={false}
    >
      <List.Item
        id="bind-shortcut"
        title={title}
        subtitle={windowTitle}
        accessories={existingShortcut ? [{ text: `Current: alt+${existingShortcut}` }] : []}
        actions={
          <ActionPanel>
            <Action title="Bind Shortcut" onAction={handleSubmit} />
          </ActionPanel>
        }
      />
    </List>
  );
}
