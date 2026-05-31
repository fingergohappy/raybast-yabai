import { usePromise } from "@raycast/utils";
import { runYabaiCommand } from "./helpers/scripts";
import SpaceList from "./components/space-list";
import { IWindow, ISpace } from "./types/yabai";
import { closeMainWindow, PopToRootType, showHUD } from "@raycast/api";

const fetchCurrentWindow = async (): Promise<IWindow> => {
  const { stderr, stdout } = await runYabaiCommand(`-m query --windows --window`);
  if (stderr) {
    throw new Error(stderr);
  }
  return JSON.parse(stdout);
};

const moveCurrentWindowToSpace = async (window: IWindow | undefined, spaceId: number) => {
  if (!window) {
    return;
  }
  await runYabaiCommand(`-m window ${window.id} --space ${spaceId}`);
  showHUD(`Moved window ${window.app}-${window.title} to space ${spaceId}`);
  closeMainWindow({ clearRootSearch: true, popToRootType: PopToRootType.Immediate });
};

const focusSpace = async (spaceId: number) => {
  await runYabaiCommand(`-m space --focus ${spaceId}`);
};

const moveAndFocusSpace = async (window: IWindow | undefined, spaceId: number) => {
  if (!window) {
    return;
  }
  await moveCurrentWindowToSpace(window, spaceId);
  await focusSpace(spaceId);
  showHUD(`Moved window ${window.app}-${window.title} to space ${spaceId}`);
  closeMainWindow({ clearRootSearch: true, popToRootType: PopToRootType.Immediate });
};

const markCurrentWindowSpace = (spaces: ISpace[], currentSpace: number | undefined): ISpace[] => {
  return spaces.map((space) => {
    if (space.index !== currentSpace) {
      return space;
    }

    return {
      ...space,
      label: space.label ? `${space.label} (Current Window Space)` : "Current Window Space",
    };
  });
};

export default function Command() {
  const { data } = usePromise(fetchCurrentWindow);

  return (
    <SpaceList
      key={data?.space ?? "loading-current-window"}
      actions={[
        {
          title: "move",
          onAction: (space: ISpace) => {
            moveCurrentWindowToSpace(data, space.index);
          },
        },
        {
          title: "move and focus",
          onAction: (space: ISpace) => {
            moveAndFocusSpace(data, space.index);
          },
        },
      ]}
      spaceFilter={(spaces: ISpace[]) => markCurrentWindowSpace(spaces, data?.space)}
      windowFilter={(windows: IWindow[]) => windows}
    />
  );
}
