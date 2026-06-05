import { Action, ActionPanel, List, showToast, Toast } from "@raycast/api";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { runYabaiCommand } from "./helpers/scripts";
import { sortWindows, BaseWindow } from "./helpers/window-utils";
import { getAppPathByPid } from "./helpers/app-icon";
import {
  clearWindowShortcuts,
  formatWindowShortcut,
  loadWindowShortcutStore,
  saveWindowShortcutStore,
} from "./helpers/window-shortcuts";
import type { WindowShortcutBinding } from "./helpers/window-shortcuts";

// yabai 返回的布尔值可能是布尔类型，也可能是数字 0/1。
type YabaiBool = boolean | 0 | 1;

// 扩展基础窗口信息，加入图标、快捷键和浮动状态字段。
interface Window extends BaseWindow {
  // 应用图标路径，用于 Raycast 列表展示。
  icon?: string;
  // 已绑定的窗口快捷键。
  shortcut?: string;
  // yabai 返回的窗口浮动状态。
  "is-floating"?: YabaiBool;
}

interface ActiveWindowShortcuts {
  // 仍然指向当前存在窗口的快捷键映射。
  shortcuts: Map<number, string>;
  // 本次清理掉的失效窗口绑定数量。
  removedCount: number;
}

// yabai space 查询结果中当前需要的字段。
interface SpaceInfo {
  // 当前 space 的索引。
  index: number;
}

// 预览窗口时保存的还原上下文。
interface PreviewWindowContext {
  // 正在预览的窗口 id。
  windowId: number;
  // 预览前窗口所在的 space。
  originalSpace: number;
  // 预览前窗口的原始坐标和尺寸。
  originalFrame: BaseWindow["frame"];
  // 预览前窗口是否已经是浮动状态。
  wasFloating: boolean;
  // 预览过程中是否为了调整窗口尺寸临时切换到浮动状态。
  madeFloatingForPreview: boolean;
}

/**
 * 将 yabai 的布尔表示统一转换为 JavaScript boolean。
 * @param value yabai 返回的布尔值或 0/1
 * @returns true 表示开启，false 表示关闭或未提供
 */
function toBoolean(value?: YabaiBool) {
  return value === true || value === 1;
}

/**
 * 获取当前可见 space 的索引。
 * @returns 成功时返回当前 space index，失败时返回 undefined
 */
async function getCurrentVisibleSpaceIndex(): Promise<number | undefined> {
  try {
    // 当前 space 查询命令的标准输出和错误输出。
    const { stdout, stderr } = await runYabaiCommand("-m query --spaces --space");
    if (stderr) {
      return undefined;
    }

    // 解析后的当前 space 信息。
    const space = JSON.parse(stdout) as SpaceInfo;
    if (typeof space.index !== "number") {
      return undefined;
    }

    return space.index;
  } catch (_error) {
    return undefined;
  }
}

/**
 * 获取当前聚焦窗口的基础信息。
 * @returns 成功时返回当前窗口信息，失败时返回 undefined
 */
async function getFocusedWindowInfo(): Promise<BaseWindow | undefined> {
  try {
    // 当前聚焦窗口查询命令的标准输出和错误输出。
    const { stdout, stderr } = await runYabaiCommand("-m query --windows --window");
    if (stderr) {
      return undefined;
    }
    // 解析后的当前聚焦窗口信息。
    const currentWindow = JSON.parse(stdout) as BaseWindow;
    return currentWindow;
  } catch (_error) {
    return undefined;
  }
}

/**
 * 将未知值转换为有效的正整数。
 * @param value 待转换的未知值
 * @returns 有效正整数或 undefined
 */
function toValidPositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.trunc(value);
}

/**
 * 将 yabai frame 数值转换为命令中使用的像素整数。
 * @param value yabai 返回的坐标或尺寸
 * @returns 四舍五入后的像素值
 */
function toYabaiPixel(value: number) {
  return Math.round(value);
}

/**
 * 决定预览窗口应移动到的目标 space。
 * @returns 当前可见 space，或聚焦窗口所在 space，无法确定时返回 undefined
 */
async function getSpaceToPreviewWindowIn(): Promise<number | undefined> {
  // 当前可见 space 的原始索引。
  const currentSpace = await getCurrentVisibleSpaceIndex();
  // 校验后的预览目标 space。
  const targetSpace = toValidPositiveInt(currentSpace);
  if (targetSpace) {
    return targetSpace;
  }

  // 当前聚焦窗口信息，用于兜底获取所在 space。
  const focusedWindow = await getFocusedWindowInfo();
  if (!focusedWindow || typeof focusedWindow.space !== "number" || focusedWindow.space <= 0) {
    return undefined;
  }

  return toValidPositiveInt(focusedWindow.space);
}

// 日志前缀，便于从 Raycast 日志中区分命令来源。
const LOG_PREFIX = "[unbind-window-shortcuts]";

/**
 * 将绑定数组转换成按 windowId 索引的快捷键映射。
 * @param bindings 解析后的 skhd 绑定列表
 * @returns 键为 window id，值为快捷键字符的映射表
 */
function createShortcutMap(bindings: WindowShortcutBinding[]) {
  // 以窗口 id 为键的快捷键映射。
  const shortcutMap = new Map<number, string>();

  bindings.forEach((item) => {
    shortcutMap.set(item.windowId, item.shortcut);
  });

  return shortcutMap;
}

/**
 * 从 skhd 绑定文件中清理已经不存在的窗口绑定，并返回仍然有效的快捷键。
 * @param existingWindowIds yabai 当前仍能查询到的窗口 id 集合
 * @returns 清理后的有效快捷键映射和删除数量
 */
async function cleanMissingWindowShortcuts(existingWindowIds: ReadonlySet<number>): Promise<ActiveWindowShortcuts> {
  // 当前 skhd 快捷键配置文件内容；文件不存在时视为没有绑定。
  const { bindings, unmanagedLines } = await loadWindowShortcutStore();
  // 清理后仍然有效的绑定。
  const activeBindings = bindings.filter((binding) => existingWindowIds.has(binding.windowId));
  // 被删除的失效绑定数量。
  const removedCount = bindings.length - activeBindings.length;

  if (removedCount > 0) {
    await saveWindowShortcutStore(activeBindings, unmanagedLines);
  }

  return {
    shortcuts: createShortcutMap(activeBindings),
    removedCount,
  };
}

/**
 * 删除某个窗口的已有快捷键绑定并写回配置文件。
 * @param windowId 目标窗口 id
 */
async function removeShortcutForWindow(windowId: number) {
  // 删除前的结构化绑定；文件不存在时视为空内容。
  const { bindings, unmanagedLines } = await loadWindowShortcutStore();
  // 删除目标窗口绑定后剩余的绑定。
  const remaining = bindings.filter((binding) => binding.windowId !== windowId);

  await saveWindowShortcutStore(remaining, unmanagedLines);
}

/**
 * 清空窗口绑定配置文件并触发 skhd 重载。
 */
async function clearAllWindowShortcuts() {
  await clearWindowShortcuts();
}

/**
 * 将目标窗口排序到列表第一位（用于入口窗口置顶）。
 * @param windows 窗口列表
 * @param targetWindowId 目标窗口 id
 * @returns 重新排序后的列表
 */
function prioritizeWindowFirst<T extends BaseWindow>(windows: T[], targetWindowId?: number): T[] {
  if (!targetWindowId) {
    return windows;
  }
  // 目标窗口在当前排序结果中的位置。
  const targetIndex = windows.findIndex((window) => window.id === targetWindowId);
  if (targetIndex <= 0) {
    return windows;
  }
  return [windows[targetIndex], ...windows.slice(0, targetIndex), ...windows.slice(targetIndex + 1)];
}

/**
 * 窗口快捷键解绑命令：清理失效绑定，仅显示已绑定快捷键的窗口，并提供解绑、清空、预览操作。
 */
export default function Command() {
  // 当前展示的已绑定窗口列表。
  const [windows, setWindows] = useState<Window[]>([]);
  // 列表加载状态。
  const [isLoading, setIsLoading] = useState(true);
  // Raycast 搜索框输入内容。
  const [searchText, setSearchText] = useState("");
  // 当前列表选中项的窗口 id 字符串。
  const [selectedWindowId, setSelectedWindowId] = useState<string>();
  // 打开命令时的焦点窗口 id，用于刷新后保持置顶。
  const [focusedWindowId, setFocusedWindowId] = useState<number>();
  // 当前正在预览的窗口上下文，便于下一次预览或失败时还原。
  const previewWindowRef = useRef<PreviewWindowContext | null>(null);

  // 根据搜索文本过滤后的窗口列表。
  const filteredWindows = useMemo(() => {
    if (!searchText) {
      return windows;
    }
    // 小写后的搜索文本，用于忽略大小写匹配。
    const lowerSearchText = searchText.toLowerCase();
    return windows.filter((window) => {
      return (
        window.title.toLowerCase().includes(lowerSearchText) ||
        window.app.toLowerCase().includes(lowerSearchText) ||
        (window.shortcut ? window.shortcut.toLowerCase().includes(lowerSearchText) : false)
      );
    });
  }, [windows, searchText]);

  /**
   * 拉取窗口列表、清理失效绑定，并刷新已绑定窗口展示状态。
   */
  const refreshWindows = useCallback(async () => {
    // 并行拉取窗口列表和当前焦点窗口。
    const [windowsResult, focusedResult] = await Promise.all([
      runYabaiCommand("-m query --windows"),
      runYabaiCommand("-m query --windows --window"),
    ]);

    if (windowsResult.stderr) {
      throw new Error(windowsResult.stderr);
    }
    // yabai 返回的窗口列表。
    const windowsData: Window[] = JSON.parse(windowsResult.stdout);
    // 当前仍然存在的窗口 id 集合，用于清理已经关闭的窗口绑定。
    const existingWindowIds = new Set(windowsData.map((window) => window.id));
    // 清理后的有效快捷键绑定。
    const { shortcuts, removedCount } = await cleanMissingWindowShortcuts(existingWindowIds);
    // 当前焦点窗口 id；无法查询时不影响清理和展示已绑定窗口。
    const activeWindowId = focusedResult.stderr
      ? undefined
      : (JSON.parse(focusedResult.stdout) as BaseWindow | undefined)?.id;
    // 用于置顶的锚点窗口 id。
    const anchorWindowId = focusedWindowId ?? activeWindowId;
    if (removedCount > 0) {
      await showToast(
        Toast.Style.Success,
        "Stale shortcuts removed",
        `${removedCount} closed window ${removedCount === 1 ? "binding was" : "bindings were"} removed`,
      );
    }

    // 只保留仍然存在且已经绑定快捷键的窗口，并补齐图标和快捷键信息。
    const windowsWithShortcuts = await Promise.all(
      windowsData
        .filter((window) => shortcuts.has(window.id))
        .map(async (window) => ({
          ...window,
          icon: await getAppPathByPid(window.pid),
          shortcut: shortcuts.get(window.id),
        })),
    );
    // 按本扩展现有规则排序后的窗口列表。
    const sortedWindows = sortWindows(windowsWithShortcuts);
    // 将入口焦点窗口移动到第一位后的窗口列表。
    const orderedWindows = prioritizeWindowFirst(sortedWindows, anchorWindowId);
    setWindows(orderedWindows);
    if (!focusedWindowId && activeWindowId) {
      setFocusedWindowId(activeWindowId);
    }
    setSelectedWindowId((currentSelectedWindowId) => {
      if (currentSelectedWindowId && orderedWindows.some((window) => String(window.id) === currentSelectedWindowId)) {
        return currentSelectedWindowId;
      }

      const selectedWindow = orderedWindows.find((window) => window.id === anchorWindowId) ?? orderedWindows[0];
      return selectedWindow ? String(selectedWindow.id) : undefined;
    });
  }, [focusedWindowId]);

  /**
   * 将预览窗口恢复到预览前的 space、frame 和浮动状态。
   * @param context 预览前保存的窗口上下文
   */
  const restoreWindow = useCallback(async (context: PreviewWindowContext) => {
    if (previewWindowRef.current?.windowId !== context.windowId) {
      return;
    }

    try {
      // 将窗口移动回原始 space 的命令错误信息。
      const { stderr: spaceErr } = await runYabaiCommand(
        `-m window ${context.windowId} --space ${context.originalSpace}`,
      );
      if (spaceErr) {
        throw new Error(spaceErr);
      }

      if (context.wasFloating || context.madeFloatingForPreview) {
        // 预览前保存的窗口原始 frame。
        const { x, y, w, h } = context.originalFrame;
        // 恢复原始窗口坐标命令的错误信息。
        const { stderr: moveErr } = await runYabaiCommand(
          `-m window ${context.windowId} --move abs:${toYabaiPixel(x)}:${toYabaiPixel(y)}`,
        );
        if (moveErr) {
          throw new Error(moveErr);
        }

        // 恢复原始窗口尺寸命令的错误信息。
        const { stderr: resizeErr } = await runYabaiCommand(
          `-m window ${context.windowId} --resize abs:${toYabaiPixel(w)}:${toYabaiPixel(h)}`,
        );
        if (resizeErr) {
          throw new Error(resizeErr);
        }
      }

      if (context.madeFloatingForPreview) {
        // 关闭预览时临时打开的浮动模式。
        const { stderr: floatErr } = await runYabaiCommand(`-m window ${context.windowId} --toggle float`);
        if (floatErr) {
          throw new Error(floatErr);
        }
      }
    } catch (error) {
      console.error(`${LOG_PREFIX} failed to restore preview window`, context.windowId, error);
    } finally {
      if (previewWindowRef.current?.windowId === context.windowId) {
        previewWindowRef.current = null;
      }
    }
  }, []);

  /**
   * 将指定窗口临时移动到当前 space 并最大化预览。
   * @param windowId 需要预览的窗口 id
   */
  async function previewWindow(windowId: number) {
    // 列表快照中的目标窗口。
    const targetWindowFromList = windows.find((window) => window.id === windowId);
    if (!targetWindowFromList) {
      return;
    }

    // 当前已经存在的预览窗口上下文。
    const activePreview = previewWindowRef.current;
    if (activePreview?.windowId === windowId) {
      await restoreWindow(activePreview);
      return;
    }
    if (activePreview) {
      await restoreWindow(activePreview);
    }

    // 用于预览的目标窗口信息，优先使用实时查询结果补全。
    let targetWindow = targetWindowFromList;
    try {
      // 目标窗口的实时查询输出和错误信息。
      const { stdout, stderr } = await runYabaiCommand(`-m query --windows --window ${windowId}`);
      if (!stderr) {
        // 实时查询得到的目标窗口信息。
        const queriedWindow = JSON.parse(stdout) as Window;
        if (queriedWindow?.id === windowId) {
          targetWindow = {
            ...targetWindow,
            ...queriedWindow,
            icon: targetWindow.icon,
            shortcut: targetWindow.shortcut,
          };
        }
      }
    } catch (_error) {
      // 实时查询失败时保留列表快照作为兜底信息。
    }

    // 预览时要使用的当前 space。
    const currentSpaceIndex = await getSpaceToPreviewWindowIn();
    if (typeof currentSpaceIndex !== "number") {
      await showToast(Toast.Style.Failure, "Failed to preview", "Cannot get current space");
      return;
    }

    // 本次预览的还原上下文。
    const context: PreviewWindowContext = {
      windowId,
      originalSpace: targetWindow.space,
      originalFrame: targetWindow.frame,
      wasFloating: toBoolean(targetWindow["is-floating"]),
      madeFloatingForPreview: false,
    };

    try {
      previewWindowRef.current = context;

      if (targetWindow.space !== currentSpaceIndex) {
        // 移动到当前 space 命令的错误信息。
        const { stderr: spaceErr } = await runYabaiCommand(`-m window ${windowId} --space ${currentSpaceIndex}`);
        if (spaceErr) {
          throw new Error(spaceErr);
        }
      }

      if (!context.wasFloating) {
        // 临时切换到浮动模式命令的错误信息。
        const { stderr: floatErr } = await runYabaiCommand(`-m window ${windowId} --toggle float`);
        if (floatErr) {
          throw new Error(floatErr);
        }
        context.madeFloatingForPreview = true;
      }

      // 将窗口最大化到当前 space 可用区域命令的错误信息。
      const { stderr: gridErr } = await runYabaiCommand(`-m window ${windowId} --grid 1:1:0:0:1:1`);
      if (gridErr) {
        throw new Error(gridErr);
      }

      await showToast(Toast.Style.Success, "Window previewed", `Window ${targetWindow.app} moved and maximized`);
    } catch (error) {
      console.error(`${LOG_PREFIX} failed to preview window`, windowId, error);
      // 预览失败时展示给用户的错误信息。
      const message = error instanceof Error ? error.message : "Unknown error";
      await showToast(Toast.Style.Failure, "Failed to preview window", message);
      await restoreWindow(context);
    }
  }

  /**
   * 记录列表高亮项变化，保持用户当前选中窗口 id。
   * @param id 列表项 id（窗口 id 字符串）
   */
  const handleSelectionChange = useCallback(
    (id: string | null) => {
      if (!id) {
        // 列表没有选中项时，也恢复当前预览窗口。
        const activePreview = previewWindowRef.current;
        if (activePreview) {
          void restoreWindow(activePreview);
        }
        return;
      }
      // 当前选中项转换后的窗口 id。
      const windowId = Number(id);
      if (!Number.isInteger(windowId) || windowId <= 0) {
        return;
      }

      setSelectedWindowId(id);

      // 列表选中项变化时，如果有其他窗口正在预览，则先恢复它。
      const activePreview = previewWindowRef.current;
      if (activePreview && activePreview.windowId !== windowId) {
        void restoreWindow(activePreview);
      }
    },
    [restoreWindow],
  );

  useEffect(() => {
    /**
     * 首次进入页面时加载窗口列表。
     */
    async function fetchWindows() {
      try {
        await refreshWindows();
      } catch (_error) {
        await showToast(Toast.Style.Failure, "Failed to fetch windows");
      } finally {
        setIsLoading(false);
      }
    }

    fetchWindows();
  }, [refreshWindows]);

  /**
   * 删除某窗口绑定后刷新列表并提示结果。
   * @param windowId 要移除绑定的窗口 id
   */
  async function handleRemoveShortcut(windowId: number) {
    try {
      await removeShortcutForWindow(windowId);
      await refreshWindows();
      await showToast(Toast.Style.Success, "Shortcut removed", `Window ${windowId} binding removed`);
    } catch (error) {
      // 删除失败时展示给用户的错误信息。
      const message = error instanceof Error ? error.message : "Unknown error";
      await showToast(Toast.Style.Failure, "Failed to remove shortcut", message);
    }
  }

  /**
   * 清空所有窗口绑定并刷新列表，清空成功后提示用户。
   */
  async function handleClearAll() {
    try {
      console.log(`${LOG_PREFIX} handleClearAll triggered`);
      await clearAllWindowShortcuts();
      await refreshWindows();
      await showToast(Toast.Style.Success, "All shortcuts cleared");
    } catch (error) {
      // 清空失败时展示给用户的错误信息。
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`${LOG_PREFIX} Failed to clear shortcuts`, error);
      await showToast(Toast.Style.Failure, "Failed to clear shortcuts", message);
    }
  }

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search bound windows..."
      selectedItemId={selectedWindowId}
      onSelectionChange={handleSelectionChange}
      onSearchTextChange={setSearchText}
    >
      {filteredWindows.length === 0 && (
        <List.EmptyView title={windows.length === 0 ? "No Bound Window Shortcuts" : "No Matching Window Shortcuts"} />
      )}
      {filteredWindows.map((window) => (
        <List.Item
          key={window.id}
          id={window.id.toString()}
          icon={{ fileIcon: window.icon || window.app }}
          title={window.app}
          subtitle={window.title}
          accessories={[
            { text: `Space ${window.space}` },
            ...(window.shortcut ? [{ text: `Shortcut ${formatWindowShortcut(window.shortcut)}` }] : []),
          ]}
          actions={
            <ActionPanel>
              <Action
                title="Preview Window"
                onAction={() => previewWindow(window.id)}
                shortcut={{ modifiers: ["cmd", "shift"], key: "f" }}
              />
              <Action
                title="Unbind Shortcut"
                shortcut={{ modifiers: ["cmd", "shift"], key: "d" }}
                onAction={() => handleRemoveShortcut(window.id)}
              />
              <Action
                title="Clear All Shortcuts"
                onAction={handleClearAll}
                shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
