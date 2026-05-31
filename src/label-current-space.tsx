import { runYabaiCommand } from "./helpers/scripts";
import { LaunchProps, showHUD } from "@raycast/api";

const labelCurrentSpace = async (label: string) => {
  await runYabaiCommand(`-m space --label ${label}`);
};

export default function Command(props: LaunchProps<{ arguments: { label: string } }>) {
  const { label } = props.arguments;
  if (!label) {
    showHUD(`No label provided`);
    return;
  }
  labelCurrentSpace(label);
  showHUD(`Labeled space with ${props.arguments.label}`);
}
