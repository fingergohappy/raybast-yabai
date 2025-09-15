import SpaceList from "./components/space-list";
import { focusSpace } from "./focus-space";
import { runYabaiCommand } from "./helpers/scripts";
import { ISpace, IWindow } from "./types/yabai";

const destorySpace = async (space: ISpace) => {
  const { stderr } = await runYabaiCommand(`-m space --destroy ${space.index}`);
  if (stderr) {
    throw new Error(stderr);
  }
};

export default function Command() {
  return <SpaceList actions={[{
    title: "focus",
    onAction: (space: ISpace) => {
      focusSpace(space.index);
    },
  }, {
    title: "destroy",
    onAction: (space: ISpace) => {
      destorySpace(space);
    },
  }]} spaceFilter={(spaces: ISpace[]) => spaces} windowFilter={(windows: IWindow[]) => windows} />;
}
