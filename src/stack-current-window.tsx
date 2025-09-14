import { usePromise } from "@raycast/utils";
import { useState, useEffect } from "react";
import { List, ActionPanel, Action, PopToRootType, closeMainWindow } from "@raycast/api";
import { runYabaiCommand } from "./helpers/scripts";
import { findAppPath } from "./helpers/app-utils";
import { IWindow } from "./types/yabai";
// fetch all window
const fetchCurrentSpaceWindows = async (): Promise<IWindow[]> => {
  const { stdout } = await runYabaiCommand(`-m query --windows --space`);
  const windows = JSON.parse(stdout);
  windows?.forEach((window: IWindow) => {
    console.log("window", window.app, window["is-sticky"]);
  });
  const filteredWindows = windows.filter((window: IWindow) => {
    if (window.app.includes("Raycast")) {
      return false;
    }
    return !window["is-sticky"] && !window["is-floating"];
  });
  return Promise.all(
    filteredWindows.map(async (window: IWindow) => ({
      ...window,
      icon: await findAppPath(window.pid),
    })),
  );
};

const getFocusedWindow = (windows: IWindow[]): IWindow | null => {
  const currentWindow = windows.filter((window) => window["has-focus"])[0];
  return currentWindow || null;
};

const stackWindow = async (
  windowId: number | string | undefined,
  targetWindowId: number | string | null | undefined,
) => {
  if (!windowId || !targetWindowId) {
    return;
  }
  runYabaiCommand(`-m window ${windowId} --stack ${targetWindowId}`);
  closeMainWindow({ clearRootSearch: true, popToRootType: PopToRootType.Immediate });
};

const fileterFocusedWindow = (focusedWindow: IWindow | null, windows: IWindow[]): IWindow[] => {
  if (!focusedWindow) {
    return windows;
  }
  const filteredWindows = windows.filter((window) => {
    return window.id !== focusedWindow.id;
  });
  filteredWindows.forEach((window) => {
    console.log("window", window.app, window.id);
  });
  console.log("focusedWindow", focusedWindow.app, focusedWindow.id);
  return filteredWindows;
};

export default function Command() {
  const { isLoading, data } = usePromise(fetchCurrentSpaceWindows);
  const focusedWindow = getFocusedWindow(data || []);
  const [selectedWindowId, setSelectedWindowId] = useState<string | null>();

  const [filteredWindows, setFilteredWindows] = useState<IWindow[]>([]);
  const [searchText, setSearchText] = useState("");
  const setFilterData = (data: IWindow[]) => {
    setFilteredWindows(fileterFocusedWindow(focusedWindow, data || []));
  };
  useEffect(() => {
    setFilterData(data || []);
  }, [data]);

  useEffect(() => {
    if (searchText) {
      setFilterData(data?.filter((window) => window.title.toLowerCase().includes(searchText.toLowerCase())) || []);
    } else {
      setFilterData(data || []);
    }
  }, [searchText]);

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search windows by name"
      onSearchTextChange={setSearchText}
      onSelectionChange={setSelectedWindowId}
    >
      {filteredWindows.map((window) => (
        <List.Item
          key={window.id}
          id={window.id.toString()}
          title={window.title}
          icon={{ fileIcon: window.icon }}
          actions={
            <ActionPanel>
              <Action title="Stack Window" onAction={() => stackWindow(focusedWindow?.id, selectedWindowId)} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
