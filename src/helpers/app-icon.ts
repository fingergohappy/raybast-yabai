import { execaCommand } from "execa";

export async function getAppPathByPid(pid: number): Promise<string> {
  if (!Number.isInteger(pid) || pid <= 0) {
    return "";
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

  if (beginIndex === -1) {
    return stdout.trim();
  }

  if (appIndex === -1) {
    return stdout.trim();
  }

  return stdout.substring(beginIndex, appIndex + 4);
}
