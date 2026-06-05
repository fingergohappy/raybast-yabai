import { execa } from "execa";
import { mkdir, readFile, writeFile } from "fs/promises";
import { homedir, userInfo } from "os";
import { join } from "path";
import { getSkhdPath } from "./skhd";

export interface WindowShortcutBinding {
  shortcut: string;
  windowId: number;
}

export interface WindowShortcutStore {
  bindings: WindowShortcutBinding[];
  unmanagedLines: string[];
}

export const SKHD_CONFIG_DIR = join(homedir(), ".config", "skhd");
export const SKHD_SHORTCUT_FILE = join(SKHD_CONFIG_DIR, "window_shortcut_skhdrc");

const FOCUS_WINDOW_SCRIPT = "~/.config/skhd/focus_window.sh";
const SKHD_MODIFIER = "alt";
const MODE_PREFIX = "window_shortcut_";

function getShortcutMode(prefix: string) {
  return `${MODE_PREFIX}${prefix}`;
}

function isShortcut(value: string) {
  return /^[a-z]{1,2}$/.test(value);
}

export function normalizeShortcutInput(value: string) {
  const withoutModifier = value
    .toLowerCase()
    .trim()
    .replace(/^alt\s*[-+]?\s*/, "");
  return withoutModifier.replace(/[^a-z]/g, "").slice(0, 2);
}

export function isValidWindowShortcut(value: string) {
  return isShortcut(value);
}

export function formatWindowShortcut(shortcut: string) {
  if (shortcut.length === 2) {
    return `alt+${shortcut[0]}, ${shortcut[1]}`;
  }

  return `alt+${shortcut}`;
}

export function shortcutHasPrefixConflict(shortcut: string, existingShortcut: string) {
  if (shortcut === existingShortcut) {
    return true;
  }

  if (shortcut.length === 2 && existingShortcut.length === 1) {
    return shortcut[0] === existingShortcut;
  }

  if (shortcut.length === 1 && existingShortcut.length === 2) {
    return existingShortcut[0] === shortcut;
  }

  return false;
}

function parseSingleShortcutLine(line: string): WindowShortcutBinding | null {
  const match = line.trim().match(/^alt\s*-\s*([a-zA-Z])\s*:\s*.*\bfocus_window\.sh\s+(\d+)(?:\s*;.*)?$/);
  if (!match) {
    return null;
  }

  return {
    shortcut: match[1].toLowerCase(),
    windowId: Number(match[2]),
  };
}

function parseModeActivationLine(line: string) {
  const match = line.trim().match(/^alt\s*-\s*([a-zA-Z])\s*;\s*window_shortcut_([a-zA-Z])\s*$/);
  if (!match || match[1].toLowerCase() !== match[2].toLowerCase()) {
    return undefined;
  }

  return match[1].toLowerCase();
}

function parseDoubleShortcutLine(line: string, activePrefixes: ReadonlySet<string>): WindowShortcutBinding | null {
  const match = line
    .trim()
    .match(
      /^window_shortcut_([a-zA-Z])\s*<\s*(?:alt\s*-\s*)?([a-zA-Z])\s*:\s*.*\bfocus_window\.sh\s+(\d+)(?:\s*;.*)?$/,
    );
  if (!match) {
    return null;
  }

  const prefix = match[1].toLowerCase();
  if (!activePrefixes.has(prefix)) {
    return null;
  }

  return {
    shortcut: `${prefix}${match[2].toLowerCase()}`,
    windowId: Number(match[3]),
  };
}

function isManagedWindowShortcutLine(line: string) {
  const trimmed = line.trim();
  return (
    /^alt\s*-\s*[a-zA-Z]\s*:\s*.*\bfocus_window\.sh\s+\d+(?:\s*;.*)?$/.test(trimmed) ||
    /^alt\s*-\s*[a-zA-Z]\s*;\s*window_shortcut_[a-zA-Z]\s*$/.test(trimmed) ||
    /^::\s*window_shortcut_[a-zA-Z](?:\s*@)?(?:\s*:\s*.*)?$/.test(trimmed) ||
    /^window_shortcut_[a-zA-Z]\s*<\s*escape\s*;\s*default\s*$/.test(trimmed) ||
    /^window_shortcut_[a-zA-Z]\s*<\s*(?:alt\s*-\s*)?[a-zA-Z]\s*:\s*.*\bfocus_window\.sh\s+\d+(?:\s*;.*)?$/.test(trimmed)
  );
}

export function parseWindowShortcutContent(content: string): WindowShortcutStore {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const activePrefixes = new Set<string>();

  lines.forEach((line) => {
    const prefix = parseModeActivationLine(line);
    if (prefix) {
      activePrefixes.add(prefix);
    }
  });

  const bindings: WindowShortcutBinding[] = [];
  const unmanagedLines: string[] = [];

  lines.forEach((line) => {
    const singleBinding = parseSingleShortcutLine(line);
    if (singleBinding) {
      bindings.push(singleBinding);
      return;
    }

    const doubleBinding = parseDoubleShortcutLine(line, activePrefixes);
    if (doubleBinding) {
      bindings.push(doubleBinding);
      return;
    }

    if (!isManagedWindowShortcutLine(line)) {
      unmanagedLines.push(line);
    }
  });

  return { bindings, unmanagedLines };
}

export async function loadWindowShortcutStore(): Promise<WindowShortcutStore> {
  const fileContent = await readFile(SKHD_SHORTCUT_FILE, "utf8").catch(() => "");
  return parseWindowShortcutContent(fileContent);
}

export async function loadWindowShortcuts() {
  const store = await loadWindowShortcutStore();
  return store.bindings;
}

function removePreviousBinding(bindings: WindowShortcutBinding[], shortcut: string, windowId: number) {
  return bindings.filter((item) => item.shortcut !== shortcut && item.windowId !== windowId);
}

function normalizeBindingsForWrite(bindings: WindowShortcutBinding[]) {
  return bindings.reduce<WindowShortcutBinding[]>((result, binding) => {
    const normalizedShortcut = normalizeShortcutInput(binding.shortcut);
    if (!isShortcut(normalizedShortcut) || !Number.isInteger(binding.windowId) || binding.windowId <= 0) {
      return result;
    }

    return [
      ...removePreviousBinding(result, normalizedShortcut, binding.windowId),
      {
        shortcut: normalizedShortcut,
        windowId: binding.windowId,
      },
    ];
  }, []);
}

function toShellCommandPath(path: string) {
  if (/^[~/A-Za-z0-9_./-]+$/.test(path)) {
    return path;
  }

  return `'${path.replace(/'/g, "'\\''")}'`;
}

function createSingleBindingLine(binding: WindowShortcutBinding) {
  return `${SKHD_MODIFIER} - ${binding.shortcut} : ${FOCUS_WINDOW_SCRIPT} ${binding.windowId}`;
}

function createDoubleBindingCommand(binding: WindowShortcutBinding, skhdPath: string) {
  return `${FOCUS_WINDOW_SCRIPT} ${binding.windowId}; ${toShellCommandPath(skhdPath)} -k escape`;
}

function createDoubleBindingLines(prefix: string, bindings: WindowShortcutBinding[], skhdPath: string) {
  const mode = getShortcutMode(prefix);
  const bindingLines = bindings.flatMap((binding) => {
    const command = createDoubleBindingCommand(binding, skhdPath);
    const secondKey = binding.shortcut[1];

    return [`${mode} < ${secondKey} : ${command}`, `${mode} < ${SKHD_MODIFIER} - ${secondKey} : ${command}`];
  });

  return [`:: ${mode}`, `${SKHD_MODIFIER} - ${prefix} ; ${mode}`, `${mode} < escape ; default`, ...bindingLines];
}

function createShortcutLines(bindings: WindowShortcutBinding[], skhdPath: string) {
  const normalizedBindings = normalizeBindingsForWrite(bindings);
  const singleBindings = normalizedBindings.filter((binding) => binding.shortcut.length === 1);
  const doubleBindingsByPrefix = new Map<string, WindowShortcutBinding[]>();

  normalizedBindings
    .filter((binding) => binding.shortcut.length === 2)
    .forEach((binding) => {
      const prefix = binding.shortcut[0];
      doubleBindingsByPrefix.set(prefix, [...(doubleBindingsByPrefix.get(prefix) ?? []), binding]);
    });

  return [
    ...singleBindings.map((binding) => createSingleBindingLine(binding)),
    ...Array.from(doubleBindingsByPrefix.entries()).flatMap(([prefix, prefixBindings]) =>
      createDoubleBindingLines(prefix, prefixBindings, skhdPath),
    ),
  ];
}

async function executeSkhd(args: string[]) {
  const skhdPath = await getSkhdPath();
  if (!skhdPath) {
    throw new Error("skhd executable not found");
  }

  return execa(skhdPath, args, {
    env: {
      ...process.env,
      USER: userInfo().username,
      HOME: homedir(),
    },
  });
}

export async function reloadSkhd() {
  try {
    await executeSkhd(["--reload"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("pid-file")) {
      await executeSkhd(["--restart-service"]);
      return;
    }

    throw error;
  }
}

export async function saveWindowShortcutStore(bindings: WindowShortcutBinding[], unmanagedLines: string[] = []) {
  const skhdPath = await getSkhdPath();
  if (!skhdPath) {
    throw new Error("skhd executable not found");
  }

  await mkdir(SKHD_CONFIG_DIR, { recursive: true });
  const lines = [...unmanagedLines, ...createShortcutLines(bindings, skhdPath)];
  await writeFile(SKHD_SHORTCUT_FILE, `${lines.join("\n")}${lines.length > 0 ? "\n" : ""}`, "utf8");
  await reloadSkhd();
}

export async function clearWindowShortcuts() {
  await mkdir(SKHD_CONFIG_DIR, { recursive: true });
  await writeFile(SKHD_SHORTCUT_FILE, "", "utf8");
  await reloadSkhd();
}
