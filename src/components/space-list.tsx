import { ActionPanel, List,Action } from "@raycast/api";
import { runYabaiCommand } from "../helpers/scripts";
import { findAppPath } from "../helpers/app-utils";
import { usePromise } from "@raycast/utils";
import { useState, useEffect } from "react";
import { ISpace, IWindow } from "../types/yabai";
import crypto from "crypto";

const fetchAllSpaces = async (): Promise<ISpace[]> => {
  const { stderr, stdout } = await runYabaiCommand(`-m query --spaces`);
  if (stderr) {
    throw new Error(stderr);
  }
  return JSON.parse(stdout);
};

const fetchAllWindows = async (): Promise<IWindow[]> => {
  const { stderr, stdout } = await runYabaiCommand(`-m query --windows`);
  if (stderr) {
    throw new Error(stderr);
  }
  const windows = JSON.parse(stdout);
  return await fetchWindowsInfo(windows);
};

const fetchWindowsInfo = async (windows: IWindow[]) => {
  return await Promise.all(
    windows.map(async (window) => ({
      ...window,
      icon: await findAppPath(window.pid),
    })),
  );
};

const filterSpaceWindows = (windows: IWindow[] | undefined, spaceIndex: number): IWindow[] => {
  return windows?.filter((window) => window.space === spaceIndex) || [];
};

const getRandomKey = () => {
  return crypto.randomBytes(16).toString("hex");
};
type MetaWindow = IWindow & { isEmpty: boolean };
const buildListMeta = (windows: IWindow[], isLoading: boolean) => {
  if (windows.length === 0) {
    return (
      <List.Item.Detail
        isLoading={isLoading}
        metadata={
          <List.Item.Detail.Metadata>
            <List.Item.Detail.Metadata.Label title="No windows" text="No windows in this space" />
          </List.Item.Detail.Metadata>
        }
      />
    );
  }
  // 隔一个插入一个新的空值
  const newWindows = windows?.reduce((acc, window) => {
    return [...acc, { isEmpty: true } as MetaWindow, { ...window, isEmpty: false }];
  }, [] as MetaWindow[]);

  return (
    <List.Item.Detail
      isLoading={isLoading}
      metadata={
        <List.Item.Detail.Metadata>
          {newWindows?.map((window) =>
            window.isEmpty ? (
              <List.Item.Detail.Metadata.Separator key={getRandomKey()} />
            ) : (
              <List.Item.Detail.Metadata.Label
                title={window.app}
                text={window.title}
                icon={{ fileIcon: window.icon }}
                key={window.id}
              />
            ),
          )}
        </List.Item.Detail.Metadata>
      }
    />
  );
};

export type SpaceListProps = {
  actions: {
    title: string;
    onAction: (space: ISpace) => void;
  }[],
  spaceFilter: (spaces: ISpace[]) => ISpace[];
  windowFilter: (windows: IWindow[]) => IWindow[];
}

export default function Command(actionHandler: SpaceListProps) {
  const { isLoading: spaceIsLoading, data: spaces } = usePromise(fetchAllSpaces, []);
  const { isLoading: windowsIsLoading, data: windows } = usePromise(fetchAllWindows, []);
  const [filteredSpaces, setSpaces] = useState<ISpace[]>([]);
  const [filteredWindows, setFilteredWindows] = useState<IWindow[]>([]);
  const [searchText, setSearchText] = useState("");
  useEffect(() => {
    setFilteredWindows(actionHandler.windowFilter(windows||[]) || []);
    setSpaces(actionHandler.spaceFilter(spaces||[]) || []);
  }, [windows, spaces]);

  useEffect(() => {
    if (!searchText) {
      setFilteredWindows(actionHandler.windowFilter(windows||[]) || []);
      setSpaces(actionHandler.spaceFilter(spaces||[]) || []);
      return;
    }
    const filteredWindows = windows
      ?.filter((window) => !window["is-sticky"])
      ?.filter(
        (window) =>
          window.title.toLowerCase().includes(searchText.toLowerCase()) ||
          window.app.toLowerCase().includes(searchText.toLowerCase()),
      );
    setFilteredWindows(actionHandler.windowFilter(filteredWindows||[]) || []);
    const windowsFilterdSpace = filteredWindows?.map((window) => window.space);
    const filteredSpaces = spaces?.filter(
      (space) =>
        windowsFilterdSpace?.includes(space.index) ||
        space.label.toLowerCase().includes(searchText.toLowerCase()) ||
        space.index.toString().includes(searchText),
    );
    setSpaces(actionHandler.spaceFilter(filteredSpaces||[]) || []);
  }, [searchText]);

  return (
    <List
      isShowingDetail
      selectedItemId={filteredSpaces?.[0]?.id}
      isLoading={spaceIsLoading}
      searchBarPlaceholder="Search spaces app or sapce"
      onSearchTextChange={setSearchText}
    >
      {filteredSpaces?.map((space) => (
        <List.Item
          key={space.index}
          subtitle={space.label}
          title={space.index.toString()}
          detail={buildListMeta(filterSpaceWindows(filteredWindows, space.index), windowsIsLoading)}
          actions={<ActionPanel>
            {actionHandler.actions.map((action, index) => (
              <Action key={index} title={action.title} onAction={() => action.onAction(space)} />
            ))}
          </ActionPanel>}
        />
      ))}
    </List>
  );
}
