import SpaceList from "./components/space-list";
import { focusSpace } from "./focus-space";
import { ISpace, IWindow } from "./types/yabai";


export default function Command() {
  return <SpaceList actions={[{
    title: "focus",
    onAction: (space: ISpace) => {
      focusSpace(space.index);
    }
  }]} spaceFilter={(spaces: ISpace[]) => spaces} windowFilter={(windows: IWindow[]) => windows} />;
}
