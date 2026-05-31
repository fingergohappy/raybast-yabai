import { Action, ActionPanel, Form, List, Toast, showToast, useNavigation } from "@raycast/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { runYabaiCommand } from "./helpers/scripts";

type YabaiBool = boolean | 0 | 1;

interface CurrentWindow {
  id: number;
  pid: number;
  app: string;
  title: string;
  scratchpad?: string;
  space?: number;
  display?: number;
  opacity?: number;
  "sub-layer"?: string;
  "split-type"?: string;
  "is-floating"?: YabaiBool;
  "is-sticky"?: YabaiBool;
  "has-shadow"?: YabaiBool;
  "has-parent-zoom"?: YabaiBool;
  "has-fullscreen-zoom"?: YabaiBool;
  "is-native-fullscreen"?: YabaiBool;
  "has-ax-reference"?: YabaiBool;
}

interface ToggleProperty {
  id: string;
  title: string;
  subtitle: string;
  toggle: string;
  requiresSIP?: boolean;
  getStatus: (window: CurrentWindow) => string;
}

interface FormProps {
  targetWindow: CurrentWindow;
  onUpdated: () => Promise<void>;
}

const TOGGLE_PROPERTIES: ToggleProperty[] = [
  {
    id: "float",
    title: "Float",
    subtitle: "Toggle whether the current window is tiled or floating.",
    toggle: "float",
    getStatus: (window) => formatBoolStatus(window["is-floating"]),
  },
  {
    id: "sticky",
    title: "Sticky",
    subtitle: "Show the current window on all spaces.",
    toggle: "sticky",
    requiresSIP: true,
    getStatus: (window) => formatBoolStatus(window["is-sticky"]),
  },
  {
    id: "pip",
    title: "Picture in Picture",
    subtitle: "Toggle picture-in-picture mode for the current window.",
    toggle: "pip",
    requiresSIP: true,
    getStatus: () => "Toggle",
  },
  {
    id: "shadow",
    title: "Shadow",
    subtitle: "Toggle the current window shadow.",
    toggle: "shadow",
    requiresSIP: true,
    getStatus: (window) => formatBoolStatus(window["has-shadow"]),
  },
  {
    id: "split",
    title: "Split Orientation",
    subtitle: "Toggle whether the current window splits vertically or horizontally.",
    toggle: "split",
    getStatus: (window) => window["split-type"] || "Toggle",
  },
  {
    id: "zoom-parent",
    title: "Zoom Parent",
    subtitle: "Toggle zooming the current window to its parent node.",
    toggle: "zoom-parent",
    getStatus: (window) => formatBoolStatus(window["has-parent-zoom"]),
  },
  {
    id: "zoom-fullscreen",
    title: "Zoom Fullscreen",
    subtitle: "Toggle zooming the current window to fill its space.",
    toggle: "zoom-fullscreen",
    getStatus: (window) => formatBoolStatus(window["has-fullscreen-zoom"]),
  },
  {
    id: "windowed-fullscreen",
    title: "Windowed Fullscreen",
    subtitle: "Toggle fullscreen inside the current space.",
    toggle: "windowed-fullscreen",
    getStatus: () => "Toggle",
  },
  {
    id: "native-fullscreen",
    title: "Native Fullscreen",
    subtitle: "Toggle native macOS fullscreen for the current window.",
    toggle: "native-fullscreen",
    getStatus: (window) => formatBoolStatus(window["is-native-fullscreen"]),
  },
  {
    id: "expose",
    title: "Expose",
    subtitle: "Toggle expose for the current window.",
    toggle: "expose",
    getStatus: () => "Toggle",
  },
];

const SUB_LAYERS = ["auto", "normal", "above", "below"] as const;
type SubLayer = (typeof SUB_LAYERS)[number];

function toBool(value: YabaiBool | undefined) {
  if (typeof value === "boolean") {
    return value;
  }

  if (value === 0 || value === 1) {
    return Boolean(value);
  }

  return undefined;
}

function formatBoolStatus(value: YabaiBool | undefined) {
  const bool = toBool(value);

  if (bool === undefined) {
    return "Unknown";
  }

  return bool ? "On" : "Off";
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function fetchWindow(windowId?: number) {
  const selector = windowId ? ` ${windowId}` : "";
  const { stdout, stderr } = await runYabaiCommand(`-m query --windows --window${selector}`);

  if (stderr) {
    throw new Error(stderr);
  }

  if (!stdout.trim()) {
    throw new Error("No focused window found.");
  }

  return JSON.parse(stdout) as CurrentWindow;
}

async function executeWindowCommand(windowId: number, command: string, successMessage: string) {
  try {
    const { stderr } = await runYabaiCommand(`-m window ${windowId} ${command}`);

    if (stderr) {
      throw new Error(stderr);
    }

    await showToast(Toast.Style.Success, successMessage);
    return true;
  } catch (error) {
    const message = getErrorMessage(error);
    if (message.includes("Yabai executable not found")) {
      return false;
    }

    await showToast(Toast.Style.Failure, "Failed to update window", message);
    return false;
  }
}

function useCurrentWindow() {
  const [targetWindow, setTargetWindow] = useState<CurrentWindow>();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();
  const targetWindowIdRef = useRef<number>();

  const loadWindow = useCallback(async () => {
    setIsLoading(true);

    try {
      const window = await fetchWindow(targetWindowIdRef.current);
      targetWindowIdRef.current = window.id;
      setTargetWindow(window);
      setError(undefined);
    } catch (error) {
      const message = getErrorMessage(error);
      setError(message);
      await showToast(Toast.Style.Failure, "Failed to fetch current window", message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWindow();
  }, [loadWindow]);

  return { targetWindow, isLoading, error, reload: loadWindow };
}

function buildAccessories(targetWindow: CurrentWindow, property: ToggleProperty) {
  const accessories = [{ text: property.getStatus(targetWindow) }];

  if (property.requiresSIP) {
    accessories.push({ text: "Requires SIP" });
  }

  return accessories;
}

async function runToggle(targetWindow: CurrentWindow, property: ToggleProperty, reload: () => Promise<void>) {
  const didUpdate = await executeWindowCommand(
    targetWindow.id,
    `--toggle ${property.toggle}`,
    `${property.title} toggled`,
  );

  if (didUpdate) {
    await reload();
  }
}

function SubLayerForm({ targetWindow, onUpdated }: FormProps) {
  const { pop } = useNavigation();
  const currentLayer = SUB_LAYERS.includes(targetWindow["sub-layer"] as SubLayer)
    ? (targetWindow["sub-layer"] as SubLayer)
    : "auto";

  async function handleSubmit(values: { layer: string }) {
    const didUpdate = await executeWindowCommand(targetWindow.id, `--sub-layer ${values.layer}`, "Sub-layer updated");

    if (didUpdate) {
      await onUpdated();
      pop();
    }
  }

  return (
    <Form
      navigationTitle="Set Sub-layer"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Set Sub-layer" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Dropdown id="layer" title="Sub-layer" defaultValue={currentLayer}>
        {SUB_LAYERS.map((layer) => (
          <Form.Dropdown.Item key={layer} value={layer} title={layer} />
        ))}
      </Form.Dropdown>
    </Form>
  );
}

function OpacityForm({ targetWindow, onUpdated }: FormProps) {
  const { pop } = useNavigation();
  const currentOpacity = typeof targetWindow.opacity === "number" ? String(targetWindow.opacity) : "1.0";

  async function handleSubmit(values: { opacity: string }) {
    const rawOpacity = values.opacity.trim();
    const opacity = Number(rawOpacity);

    if (!rawOpacity || Number.isNaN(opacity) || opacity < 0 || opacity > 1) {
      await showToast(Toast.Style.Failure, "Invalid opacity", "Use a value between 0.0 and 1.0.");
      return;
    }

    const didUpdate = await executeWindowCommand(targetWindow.id, `--opacity ${rawOpacity}`, "Opacity updated");

    if (didUpdate) {
      await onUpdated();
      pop();
    }
  }

  async function resetOpacity() {
    const didUpdate = await executeWindowCommand(targetWindow.id, "--opacity 0.0", "Opacity reset");

    if (didUpdate) {
      await onUpdated();
      pop();
    }
  }

  return (
    <Form
      navigationTitle="Set Opacity"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Set Opacity" onSubmit={handleSubmit} />
          <Action title="Reset Opacity Management" onAction={resetOpacity} />
        </ActionPanel>
      }
    >
      <Form.TextField id="opacity" title="Opacity" placeholder="0.0 - 1.0" defaultValue={currentOpacity} />
    </Form>
  );
}

function ScratchpadForm({ targetWindow, onUpdated }: FormProps) {
  const { pop } = useNavigation();

  async function handleSubmit(values: { label: string }) {
    const label = values.label.trim();

    if (!label) {
      await showToast(Toast.Style.Failure, "Invalid scratchpad label", "Label is required.");
      return;
    }

    if (/\s/.test(label)) {
      await showToast(Toast.Style.Failure, "Invalid scratchpad label", "Use a label without spaces.");
      return;
    }

    const didUpdate = await executeWindowCommand(targetWindow.id, `--scratchpad ${label}`, "Scratchpad updated");

    if (didUpdate) {
      await onUpdated();
      pop();
    }
  }

  async function clearScratchpad() {
    const didUpdate = await executeWindowCommand(targetWindow.id, "--scratchpad", "Scratchpad cleared");

    if (didUpdate) {
      await onUpdated();
      pop();
    }
  }

  return (
    <Form
      navigationTitle="Set Scratchpad"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Set Scratchpad" onSubmit={handleSubmit} />
          <Action title="Clear Scratchpad" style={Action.Style.Destructive} onAction={clearScratchpad} />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="label"
        title="Label"
        placeholder="scratchpad-label"
        defaultValue={targetWindow.scratchpad || ""}
      />
    </Form>
  );
}

export default function Command() {
  const { targetWindow, isLoading, error, reload } = useCurrentWindow();

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search window properties">
      {!targetWindow && !isLoading ? (
        <List.EmptyView title="No Current Window" description={error || "Could not read the focused yabai window."} />
      ) : null}
      {targetWindow ? (
        <>
          <List.Section title="Current Window">
            <List.Item
              title={targetWindow.app}
              subtitle={targetWindow.title || "Untitled"}
              accessories={[
                { text: `ID ${targetWindow.id}` },
                ...(targetWindow.space ? [{ text: `Space ${targetWindow.space}` }] : []),
                ...(targetWindow.display ? [{ text: `Display ${targetWindow.display}` }] : []),
              ]}
              actions={
                <ActionPanel>
                  <Action title="Refresh" onAction={reload} />
                </ActionPanel>
              }
            />
          </List.Section>

          <List.Section title="Toggle Properties">
            {TOGGLE_PROPERTIES.map((property) => (
              <List.Item
                key={property.id}
                title={property.title}
                subtitle={property.subtitle}
                accessories={buildAccessories(targetWindow, property)}
                actions={
                  <ActionPanel>
                    <Action
                      title={`Toggle ${property.title}`}
                      onAction={() => runToggle(targetWindow, property, reload)}
                    />
                    <Action title="Refresh" onAction={reload} />
                  </ActionPanel>
                }
              />
            ))}
          </List.Section>

          <List.Section title="Set Properties">
            <List.Item
              title="Sub-layer"
              subtitle="Set stacking sub-layer to auto, normal, above, or below."
              accessories={[{ text: targetWindow["sub-layer"] || "Unknown" }, { text: "Requires SIP" }]}
              actions={
                <ActionPanel>
                  <Action.Push
                    title="Set Sub-layer"
                    target={<SubLayerForm targetWindow={targetWindow} onUpdated={reload} />}
                  />
                  <Action title="Refresh" onAction={reload} />
                </ActionPanel>
              }
            />
            <List.Item
              title="Opacity"
              subtitle="Set explicit window opacity; use 0.0 to reset automatic opacity management."
              accessories={[
                { text: typeof targetWindow.opacity === "number" ? String(targetWindow.opacity) : "Unknown" },
                { text: "Requires SIP" },
              ]}
              actions={
                <ActionPanel>
                  <Action.Push
                    title="Set Opacity"
                    target={<OpacityForm targetWindow={targetWindow} onUpdated={reload} />}
                  />
                  <Action
                    title="Reset Opacity Management"
                    onAction={async () => {
                      const didUpdate = await executeWindowCommand(targetWindow.id, "--opacity 0.0", "Opacity reset");

                      if (didUpdate) {
                        await reload();
                      }
                    }}
                  />
                  <Action title="Refresh" onAction={reload} />
                </ActionPanel>
              }
            />
            <List.Item
              title="Scratchpad"
              subtitle="Assign or clear a scratchpad label for the current window."
              accessories={[{ text: targetWindow.scratchpad || "None" }, { text: "Requires SIP" }]}
              actions={
                <ActionPanel>
                  <Action.Push
                    title="Set Scratchpad"
                    target={<ScratchpadForm targetWindow={targetWindow} onUpdated={reload} />}
                  />
                  <Action
                    title="Clear Scratchpad"
                    style={Action.Style.Destructive}
                    onAction={async () => {
                      const didUpdate = await executeWindowCommand(
                        targetWindow.id,
                        "--scratchpad",
                        "Scratchpad cleared",
                      );

                      if (didUpdate) {
                        await reload();
                      }
                    }}
                  />
                  <Action title="Refresh" onAction={reload} />
                </ActionPanel>
              }
            />
          </List.Section>
        </>
      ) : null}
    </List>
  );
}
