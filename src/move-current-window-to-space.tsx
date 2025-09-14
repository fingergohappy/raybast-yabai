import { usePromise } from "@raycast/utils";
import { runYabaiCommand } from "./helpers/scripts";
import SpaceList from "./components/space-list";
import { Action } from "@raycast/api";

const fetchCurrentWindow = async () => {
  const { stderr, stdout } = await runYabaiCommand(`-m query --windows --window`);
  if (stderr) {
    throw new Error(stderr);
  }
  return JSON.parse(stdout);
};
export default function Command() {
  const { isLoading, data } = usePromise(fetchCurrentWindow);
  return (
    <SpaceList
      Action={
        <Action
          title="move"
          onAction={() => {
            moveCurrentWindowToSpace(data?.id);
          }}
        />
      }
    />
  );
}
