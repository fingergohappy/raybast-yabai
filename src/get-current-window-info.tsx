import { Action, ActionPanel, Detail } from "@raycast/api";
import { runYabaiCommand } from "./helpers/scripts";
import { useEffect } from "react";
import { useState } from "react";

const useCurrentWindowInfo = () => {
  const [windowInfo, setWindowInfo] = useState<string>("");
  useEffect(() => {
    (async () => {
      const { stderr, stdout } = await runYabaiCommand(`-m query --windows --window`);
      if (stderr) {
        throw new Error(stderr);
      }
      console.log(stdout);
      setWindowInfo(JSON.parse(stdout));
    })();
  }, []);
  return windowInfo;
};

export default function Command() {
  const windowInfo = useCurrentWindowInfo();
  const windowInfoMarkDownJson = `\`\`\`json\n${JSON.stringify(windowInfo, null, 2)}\n\`\`\``;
  return (
    <Detail
      markdown={windowInfoMarkDownJson}
      actions={
        <ActionPanel>
          <Action
            title="Copy"
            onAction={() => {
              navigator.clipboard.writeText(windowInfoMarkDownJson);
            }}
          />
        </ActionPanel>
      }
    />
  );
}
