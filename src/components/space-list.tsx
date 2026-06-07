import { ActionPanel, Action, Color, Icon, List } from "@raycast/api";
import { runYabaiCommand } from "../helpers/scripts";
import { usePromise } from "@raycast/utils";
import { useMemo, useState } from "react";
import { ISpace, IWindow } from "../types/yabai";

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
  return JSON.parse(stdout);
};

const fetchCurrentSpace = async (): Promise<ISpace> => {
  const { stderr, stdout } = await runYabaiCommand(`-m query --spaces --space`);
  if (stderr) {
    throw new Error(stderr);
  }
  return JSON.parse(stdout);
};

const filterSpaceWindows = (windows: IWindow[] | undefined, spaceIndex: number): IWindow[] => {
  return windows?.filter((window) => window.space === spaceIndex) || [];
};

const getSpaceItemId = (spaceIndex: number) => `space-${spaceIndex}`;

const getWindowCountText = (count: number) => {
  return `${count} window${count === 1 ? "" : "s"}`;
};

const getSpaceTitle = (space: ISpace) => {
  return space.label ? `Space ${space.index} - ${space.label}` : `Space ${space.index}`;
};

const getDisplaySpaceTitle = (space: ISpace, isCurrentSpace: boolean) => {
  return isCurrentSpace ? `${getSpaceTitle(space)} [Current]` : getSpaceTitle(space);
};

const getWindowTitle = (window: IWindow) => {
  const title = window.title.trim();
  return title || window.app || `Window ${window.id}`;
};

const getSpaceKeywords = (space: ISpace, windows: IWindow[]) => {
  return [
    space.index.toString(),
    space.label,
    ...windows.flatMap((window) => [window.app, window.title].filter(Boolean)),
  ].filter(Boolean);
};

const getDisplayIndex = (space: ISpace) => {
  return typeof space.display === "number" ? space.display : 0;
};

const groupSpacesByDisplay = (spaces: ISpace[]) => {
  const groups = new Map<number, ISpace[]>();

  spaces.forEach((space) => {
    const displayIndex = getDisplayIndex(space);
    groups.set(displayIndex, [...(groups.get(displayIndex) || []), space]);
  });

  return [...groups.entries()]
    .sort(([displayA], [displayB]) => displayA - displayB)
    .map(([display, spaces]) => ({
      display,
      spaces: spaces.sort((spaceA, spaceB) => spaceA.index - spaceB.index),
    }));
};

const buildSpaceDetailMarkdown = (space: ISpace, windows: IWindow[], isCurrentSpace: boolean) => {
  const heading = `# ${getDisplaySpaceTitle(space, isCurrentSpace)}`;
  const summary = `**${getWindowCountText(windows.length)}**`;

  if (windows.length === 0) {
    return `${heading}\n\n${summary}\n\nNo windows in this space.`;
  }

  const windowLines = windows.map((window) => {
    const app = window.app ? ` _${window.app}_` : "";
    return `- **${getWindowTitle(window)}**${app}`;
  });

  return `${heading}\n\n${summary}\n\n${windowLines.join("\n")}`;
};

const buildSpaceDetail = (space: ISpace, windows: IWindow[], isCurrentSpace: boolean, isLoading: boolean) => {
  return (
    <List.Item.Detail
      isLoading={isLoading}
      markdown={buildSpaceDetailMarkdown(space, windows, isCurrentSpace)}
      metadata={
        <List.Item.Detail.Metadata>
          <List.Item.Detail.Metadata.Label
            title="Desktop"
            text={getDisplayIndex(space).toString()}
            icon={Icon.Desktop}
          />
          <List.Item.Detail.Metadata.Label title="Space" text={space.index.toString()} />
          {isCurrentSpace ? (
            <List.Item.Detail.Metadata.Label
              title="Current Space"
              text={{ value: "Yes", color: Color.Blue }}
              icon={Icon.CheckCircle}
            />
          ) : null}
          <List.Item.Detail.Metadata.Label title="Windows" text={windows.length.toString()} />
        </List.Item.Detail.Metadata>
      }
    />
  );
};

const getSpaceAccessories = (windows: IWindow[], isCurrentSpace: boolean): List.Item.Accessory[] => {
  return [
    ...(isCurrentSpace ? [{ tag: { value: "Current", color: Color.Blue }, icon: Icon.CheckCircle }] : []),
    { text: getWindowCountText(windows.length), icon: Icon.AppWindowList },
  ];
};

export type SpaceListProps = {
  actions: {
    title: string;
    onAction: (space: ISpace) => void;
  }[];
  spaceFilter: (spaces: ISpace[]) => ISpace[];
  windowFilter: (windows: IWindow[]) => IWindow[];
  selectedSpaceIndex?: number;
};

export default function Command({ actions, spaceFilter, windowFilter, selectedSpaceIndex }: SpaceListProps) {
  const { isLoading: spaceIsLoading, data: spaces } = usePromise(fetchAllSpaces, []);
  const { isLoading: windowsIsLoading, data: windows } = usePromise(fetchAllWindows, []);
  const { isLoading: currentSpaceIsLoading, data: currentSpace } = usePromise(fetchCurrentSpace, []);
  const [searchText, setSearchText] = useState("");

  const { filteredSpaces, filteredWindows } = useMemo(() => {
    if (!searchText) {
      return {
        filteredWindows: windowFilter(windows || []) || [],
        filteredSpaces: spaceFilter(spaces || []) || [],
      };
    }

    const filteredWindows = windows
      ?.filter((window) => !window["is-sticky"])
      ?.filter(
        (window) =>
          window.title.toLowerCase().includes(searchText.toLowerCase()) ||
          window.app.toLowerCase().includes(searchText.toLowerCase()),
      );
    const windowsFilterdSpace = filteredWindows?.map((window) => window.space);
    const filteredSpaces = spaces?.filter(
      (space) =>
        windowsFilterdSpace?.includes(space.index) ||
        space.label.toLowerCase().includes(searchText.toLowerCase()) ||
        space.index.toString().includes(searchText),
    );

    return {
      filteredWindows: windowFilter(filteredWindows || []) || [],
      filteredSpaces: spaceFilter(filteredSpaces || []) || [],
    };
  }, [searchText, spaceFilter, spaces, windowFilter, windows]);

  const selectedSpace = filteredSpaces.find((space) => space.index === selectedSpaceIndex) || filteredSpaces[0];
  const selectedItemId = selectedSpace ? getSpaceItemId(selectedSpace.index) : undefined;
  const currentSpaceIndex = currentSpace?.index || spaces?.find((space) => space["has-focus"])?.index;
  const groupedSpaces = groupSpacesByDisplay(filteredSpaces);

  return (
    <List
      isShowingDetail
      isLoading={spaceIsLoading || windowsIsLoading || currentSpaceIsLoading}
      searchBarPlaceholder="Search spaces, windows, or apps"
      selectedItemId={selectedItemId}
      onSearchTextChange={setSearchText}
    >
      {groupedSpaces.map((group) => (
        <List.Section
          key={group.display}
          title={group.display > 0 ? `Desktop ${group.display}` : "Desktop"}
          subtitle={`${group.spaces.length} space${group.spaces.length === 1 ? "" : "s"}`}
        >
          {group.spaces.map((space) => {
            const spaceWindows = filterSpaceWindows(filteredWindows, space.index);
            const isCurrentSpace = space.index === currentSpaceIndex;

            return (
              <List.Item
                id={getSpaceItemId(space.index)}
                key={space.index}
                icon={{
                  source: Icon.Desktop,
                  tintColor: isCurrentSpace ? Color.Blue : Color.SecondaryText,
                }}
                title={getDisplaySpaceTitle(space, isCurrentSpace)}
                subtitle={space.label || undefined}
                accessories={getSpaceAccessories(spaceWindows, isCurrentSpace)}
                keywords={getSpaceKeywords(space, spaceWindows)}
                detail={buildSpaceDetail(space, spaceWindows, isCurrentSpace, windowsIsLoading)}
                actions={
                  <ActionPanel>
                    {actions.map((action, index) => (
                      <Action key={index} title={action.title} onAction={() => action.onAction(space)} />
                    ))}
                  </ActionPanel>
                }
              />
            );
          })}
        </List.Section>
      ))}
    </List>
  );
}
