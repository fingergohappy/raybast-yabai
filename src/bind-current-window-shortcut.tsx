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
import { useEffect, useState } from "react";
import { runYabaiCommand } from "./helpers/scripts";
import {
  formatWindowShortcut,
  isValidWindowShortcut,
  loadWindowShortcutStore,
  loadWindowShortcuts,
  normalizeShortcutInput,
  saveWindowShortcutStore,
  shortcutHasPrefixConflict,
} from "./helpers/window-shortcuts";
import { IWindow } from "./types/yabai";

interface ShortcutConflict {
  shortcut: string;
  windowId: number;
}

async function bindWindowShortcut(windowId: number, shortcut: string) {
  const normalizedShortcut = normalizeShortcutInput(shortcut);
  const { bindings, unmanagedLines } = await loadWindowShortcutStore();
  const keepBindings = bindings.filter((binding) => {
    if (binding.windowId === windowId) {
      return false;
    }

    return !shortcutHasPrefixConflict(normalizedShortcut, binding.shortcut);
  });

  await saveWindowShortcutStore([...keepBindings, { shortcut: normalizedShortcut, windowId }], unmanagedLines);
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

async function checkShortcutConflicts(
  windowId: number,
  shortcut: string,
  existingWindowIds: ReadonlySet<number>,
): Promise<ShortcutConflict[]> {
  const bindings = await loadWindowShortcuts();
  return bindings
    .filter((item) => {
      if (!shortcutHasPrefixConflict(shortcut, item.shortcut)) {
        return false;
      }

      return item.windowId === windowId || existingWindowIds.has(item.windowId);
    })
    .map((item) => ({
      shortcut: item.shortcut,
      windowId: item.windowId,
    }));
}

function isSameWindowSameShortcut(conflicts: ShortcutConflict[], windowId: number, shortcut: string) {
  return conflicts.length === 1 && conflicts[0].windowId === windowId && conflicts[0].shortcut === shortcut;
}

function getConflictSummary(conflicts: ShortcutConflict[], windows: IWindow[]) {
  return conflicts
    .map(
      (conflict) => `${formatWindowShortcut(conflict.shortcut)} -> ${getWindowLabelById(conflict.windowId, windows)}`,
    )
    .join("；");
}

async function confirmShortcutReplacement(shortcut: string, conflicts: ShortcutConflict[], windows: IWindow[]) {
  return confirmAlert({
    title: "Shortcut already bound",
    message: `${formatWindowShortcut(shortcut)} 会覆盖 ${getConflictSummary(conflicts, windows)}，是否继续？`,
    primaryAction: {
      title: "替换",
      style: Alert.ActionStyle.Destructive,
    },
    dismissAction: {
      title: "取消",
      style: Alert.ActionStyle.Cancel,
    },
  });
}

function getExistingActiveConflicts(
  conflicts: ShortcutConflict[],
  shortcut: string,
  currentWindowId: number,
): ShortcutConflict[] {
  return conflicts.filter((conflict) => {
    if (conflict.shortcut !== shortcut) {
      return false;
    }

    return conflict.windowId !== currentWindowId;
  });
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
      const bindings = await loadWindowShortcuts();
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

    const pressedKey = normalizeShortcutInput(shortcut);
    if (!isValidWindowShortcut(pressedKey)) {
      await showToast(Toast.Style.Failure, "Invalid shortcut", "Please input one or two letters (a-z)");
      return;
    }

    try {
      const allWindows = await fetchWindows();
      const existingWindowIds = new Set(allWindows.map((window) => window.id));
      const conflicts = await checkShortcutConflicts(currentWindow.id, pressedKey, existingWindowIds);
      if (conflicts.length > 0) {
        if (isSameWindowSameShortcut(conflicts, currentWindow.id, pressedKey)) {
          await showSuccess(`${formatWindowShortcut(pressedKey)} is already bound to this window`);
          return;
        }

        const replacementConflicts =
          getExistingActiveConflicts(conflicts, pressedKey, currentWindow.id).length > 0
            ? conflicts
            : conflicts.filter(
                (conflict) => conflict.shortcut !== pressedKey || conflict.windowId !== currentWindow.id,
              );
        const shouldReplace = await confirmShortcutReplacement(pressedKey, replacementConflicts, allWindows);
        if (!shouldReplace) {
          return;
        }
      }

      await bindWindowShortcut(currentWindow.id, pressedKey);
      await showSuccess(`${currentWindow.app}: ${currentWindow.title} -> ${formatWindowShortcut(pressedKey)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      await showToast(Toast.Style.Failure, "Failed to bind shortcut", message);
    }
  }

  const pressedKey = normalizeShortcutInput(shortcut);
  const title =
    existingShortcut && pressedKey === existingShortcut
      ? `Current binding: ${formatWindowShortcut(existingShortcut)}`
      : pressedKey
        ? `Bind ${formatWindowShortcut(pressedKey)}`
        : "Input one or two letters to bind";
  const windowTitle = currentWindow?.title ? `${currentWindow.app} (${currentWindow.title})` : currentWindow?.app;

  return (
    <List
      isLoading={isLoading}
      navigationTitle={`Bind Shortcut for ${currentWindow?.app ?? "Current Window"}`}
      searchBarPlaceholder="输入 1-2 个字母（例如 a 或 aa），按 Enter 绑定"
      searchText={shortcut}
      onSearchTextChange={(value) => setShortcut(normalizeShortcutInput(value))}
      filtering={false}
    >
      <List.Item
        id="bind-shortcut"
        title={title}
        subtitle={windowTitle}
        accessories={existingShortcut ? [{ text: `Current: ${formatWindowShortcut(existingShortcut)}` }] : []}
        actions={
          <ActionPanel>
            <Action title="Bind Shortcut" onAction={handleSubmit} />
          </ActionPanel>
        }
      />
    </List>
  );
}
