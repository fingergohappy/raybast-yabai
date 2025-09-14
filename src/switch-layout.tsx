import { Action, ActionPanel, closeMainWindow, PopToRootType, showHUD } from "@raycast/api";
import { List } from "@raycast/api";
import { runYabaiCommand } from "./helpers/scripts";
import { useEffect, useState } from "react";
import { getAvatarIcon } from "@raycast/utils";

const layouts = [
  {
    title: "BSP",
    name: "bsp",
    icon: getAvatarIcon("BSP"),
  },
  {
    title: "Stack",
    name: "stack",
    icon: getAvatarIcon("Stack"),
  },
  {
    title: "Float",
    name: "float",
    icon: getAvatarIcon("Float"),
  },
];
export async function selectLayout(layout: string) {
  const { stderr } = await runYabaiCommand(`-m space --layout ${layout}`);
  if (stderr) {
    throw new Error(stderr);
  }
  closeMainWindow({ clearRootSearch: true, popToRootType: PopToRootType.Immediate });
  showHUD(`Switched to ${layout} layout`);
}

const useCurrentLayout = () => {
  const [layout, setLayout] = useState<string>("");
  useEffect(() => {
    (async () => {
      const { stderr, stdout } = await runYabaiCommand(`-m query --spaces --space`);
      if (stderr) {
        throw new Error(stderr);
      }
      setLayout(JSON.parse(stdout).type);
    })();
  }, []);
  return layout;
};

export default function Command() {
  const currentLayout = useCurrentLayout();
  return (
    <List isLoading={!currentLayout} selectedItemId={currentLayout}>
      {layouts?.map((item) => (
        <List.Item
          id={item.name}
          key={item.title}
          icon={item.icon}
          title={item.title}
          accessories={[{ text: item.title }]}
          actions={
            <ActionPanel>
              <ActionPanel.Section>
                <Action title="Focus" onAction={() => selectLayout(item.name)} />
              </ActionPanel.Section>
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
