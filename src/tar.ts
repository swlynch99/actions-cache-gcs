import { exec } from "@actions/exec";
import * as io from "@actions/io";
import * as core from "@actions/core";
import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import * as path from "path";
import {
  getWorkingDirectory,
  getCacheFilename,
  CompressionMethod,
} from "./utils.js";

type ArchiveToolType = "gnu" | "bsd";
type ArchiveTool = {
  path: string;
  type: ArchiveToolType;
};
type CommandType = "create" | "extract" | "list";

const SepRe = new RegExp(`\\${path.sep}`, "g");
const ManifestFilename = "manifest.txt";

export async function createTar(
  archivedir: string,
  sourcedirs: string[],
  method: CompressionMethod
): Promise<void> {
  await writeFile(path.join(archivedir, ManifestFilename), sourcedirs.join("\n"));
  const commands = await getCommands(method, "create");
  await execCommands(commands);
}

export async function extractTar(
  archivePath: string,
  method: CompressionMethod
): Promise<void> {
  const workdir = getWorkingDirectory();
  await io.mkdirP(workdir);

  const commands = await getCommands(method, "extract", archivePath);
  await execCommands(commands)
}

async function getGnuTarPathOnWindows(): Promise<string | undefined> {
  const gnuPath = `${process.env["PROGRAMFILES"]}\\Git\\usr\\bin\\tar.exe`;
  if (existsSync(gnuPath)) {
    return gnuPath;
  }

  const versionOutput = await getVersion("tar");
  return versionOutput.toLowerCase().includes("gnu tar")
    ? io.which("tar")
    : undefined;
}

async function getTarPath(): Promise<ArchiveTool> {
  switch (process.platform) {
    case "win32": {
      const gnuTar = await getGnuTarPathOnWindows();
      const systemTar = `${process.env["SYSTEMDRIVE"]}\\Windows\\System32\\tar.exe`;

      if (gnuTar) {
        return { path: gnuTar, type: "gnu" };
      } else {
        return { path: systemTar, type: "bsd" };
      }
    }
    case "darwin": {
      const gnuTar = await io.which("gtar", false);
      if (gnuTar) {
        return { path: gnuTar, type: "gnu" };
      }

      return {
        path: await io.which("tar", true),
        type: "bsd",
      };
    }
    default:
      return {
        path: await io.which("tar", true),
        type: "gnu",
      };
  }
}

async function getTarArgs(
  tar: ArchiveTool,
  method: CompressionMethod,
  type: CommandType,
  archive: string = ""
): Promise<string[]> {
  const args = [`${tar.path}`];
  const filename = getCacheFilename(method);
  const workdir = getWorkingDirectory();
  const tarfile = "cache.tar";

  const bsdTarZstd =
    tar.type === "bsd" && method === "zstd" && process.platform === "win32";

  switch (type) {
    case "create":
      args.push(
        "--posix",
        "-cf",
        bsdTarZstd ? tarfile : filename.replace(SepRe, "/"),
        "--exclude",
        bsdTarZstd ? tarfile : filename.replace(SepRe, "/"),
        "-P",
        "-C",
        workdir.replace(SepRe, "/"),
        "--files-from",
        ManifestFilename
      );
      break;
    case "extract":
      args.push(
        "-xf",
        bsdTarZstd ? tarfile : archive.replace(SepRe, "/"),
        "-P",
        "-C",
        workdir.replace(SepRe, "/")
      );
      break;
    case "list":
      args.push(
        "-tf",
        bsdTarZstd ? tarfile : archive.replace(SepRe, "/"),
        "-P"
      );
      break;
  }

  if (tar.type === "gnu") {
    switch (process.platform) {
      case "win32":
        args.push("--force-local");
        break;
      case "darwin":
        args.push("--delay-directory-restore");
        break;
    }
  }

  return args;
}

async function getCommands(
  method: CompressionMethod,
  type: CommandType,
  archive: string = ""
): Promise<string[]> {
  const tar = await getTarPath();
  const tarArgs = await getTarArgs(tar, method, type, archive);
  const compressArgs =
    type !== "create"
      ? await getDecompressionProgram(tar, method, archive)
      : await getCompressionProgram(tar, method);
  const bsdTarZstd =
    tar.type === "bsd" && method === "zstd" && process.platform === "win32";

  let args;
  if (bsdTarZstd && type !== "create") {
    args = [[...compressArgs].join(" "), [...tarArgs].join(" ")];
  } else {
    args = [[...tarArgs].join(" "), [...compressArgs].join(" ")];
  }

  if (bsdTarZstd) {
    return args;
  }

  return [args.join(" ")];
}

async function getCompressionProgram(
  tar: ArchiveTool,
  method: CompressionMethod
): Promise<string[]> {
  const filename = getCacheFilename(method);
  const bsdTarZstd =
    tar.type === "bsd" && method === "zstd" && process.platform === "win32";

  switch (method) {
    case "zstd":
      return bsdTarZstd
        ? ["zstd -T0 --force -o", filename.replace(SepRe, "/"), "cache.tar"]
        : [
            "--use-compress-program",
            process.platform === "win32" ? '"zstd -T0"' : "zstdmt",
          ];
    default:
      return ["-z"];
  }
}

async function getDecompressionProgram(
  tar: ArchiveTool,
  method: CompressionMethod,
  archive: string
): Promise<string[]> {
  const bsdTarZstd =
    tar.type === "bsd" && method === "zstd" && process.platform === "win32";

  switch (method) {
    case "zstd":
      return bsdTarZstd
        ? ["zstd -d --force -o", "cache.tar", archive.replace(SepRe, "/")]
        : [
            "--use-compress-program",
            process.platform === "win32" ? '"zstd -d"' : "zstdmt",
          ];
    default:
      return ["-z"];
  }
}

async function getVersion(
  app: string,
  additionalArgs: string[] = []
): Promise<string> {
  let versionOutput = "";
  additionalArgs.push("--version");
  core.debug(`Checking ${app} ${additionalArgs.join(" ")}`);
  try {
    await exec(`${app}`, additionalArgs, {
      ignoreReturnCode: true,
      silent: true,
      listeners: {
        stdout: (data: Buffer): string => (versionOutput += data.toString()),
        stderr: (data: Buffer): string => (versionOutput += data.toString()),
      },
    });
  } catch (err) {
    core.debug(`${err}`);
  }

  versionOutput = versionOutput.trim();
  core.debug(versionOutput);
  return versionOutput;
}

async function execCommands(commands: string[], cwd?: string) {
  for (const command of commands) {
    try {
      await exec(command, undefined, { cwd });
    } catch (error) {
      throw new Error(
        `${command.split(" ")[0]} failed with error ${(error as Error).message}`
      );
    }
  }
}
