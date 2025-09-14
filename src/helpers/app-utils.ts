import { execaCommand } from "execa";

export async function findAppPath(pid: number): Promise<string> {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error("Invalid process ID");
  }
  const { stdout, stderr } = await execaCommand(`/usr/sbin/lsof -p ${pid} | grep txt | grep -v DEL | head -n 1 `, {
    shell: true,
  });
  if (stderr) {
    console.error(stderr);
    return "";
  }
  const beginIndex = stdout.indexOf("/");
  const appIndex = stdout.indexOf(".app");
  if (appIndex === -1) {
    return stdout;
  }
  const appPath = stdout.substring(beginIndex, appIndex + 4);
  return appPath;
}