import * as io from "@actions/io";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as glob from "@actions/glob";
import { context } from "@actions/github";
import { File, Storage } from "@google-cloud/storage";
import * as path from "path";
import * as crypto from "crypto";
import { ValidationError } from "./error";
import {
  UploadOptions,
  DownloadOptions,
  getUploadOptions,
  getDownloadOptions,
} from "./options";
import { writeFile } from "node:fs/promises";

const ContentTypePrefix = "application/x-actions-cache-gcs-";

/**
 * isFeatureAvailable checks whether the cache service is available.
 * 
 * @returns true - with the right configuration it should always be possible to
 *          use GCS as a cache.
 */
export function isFeatureAvailable(): boolean {
  return true;
}

/**
 * Saves a list of files with the specified key.
 *
 * @param paths a list of file paths to be cached
 * @param key an explicit key for restoring the cache
 * @param options cache upload options
 * @throws an error if the save fails
 */
export async function saveCache(
  paths: string[],
  key: string,
  options?: UploadOptions
): Promise<void> {
  options = getUploadOptions(options);

  const method = await getCompressionMethod();
  const storage = new Storage();
  const cachePaths = await resolvePaths(paths);

  core.debug(`Cache Paths: ${JSON.stringify(cachePaths)}`);

  if (cachePaths.length === 0) {
    throw new ValidationError(
      `Path Validation Error: Path(s) specified in teh action for caching do(es) not exist, hence no cache is being saved`
    );
  }

  const tempdir = await createTempDirectory();
  const archive = path.join(tempdir, `cache.tar.${method}`);
  const repo = context.repo.repo;

  core.debug(`Archive Path: ${archive}`);

  try {
    await createTar(archive, tempdir, paths, method);

    const bucket = storage.bucket(options.bucket!);

    bucket.upload(archive, {
      destination: `${repo}/${key}`,
      contentType: `${ContentTypePrefix}${method}`,
    });
  } catch (e) {}

  throw "not implemented";
}

/**
 * Restores cache from keys.
 *
 * @param paths a list of file paths to restore from the cache.
 * @param primaryKey and explicit key for restoring from the cache. Lookup is done with prefix matching.
 * @param restoreKeys an optional ordered list of keys to use for restoring the cache if no cache hit occurred for primaryKey.
 * @param options cache download options.
 */
export async function restoreCache(
  paths: string[],
  primaryKey: string,
  restoreKeys?: string[],
  options?: DownloadOptions
): Promise<string | undefined> {
  options = getDownloadOptions(options);

  restoreKeys = restoreKeys || [];
  const keys = [primaryKey, ...restoreKeys];

  core.debug(`Resolved Keys: ${JSON.stringify(keys)}`);

  if (keys.length > 10) {
    throw new ValidationError(
      `Key Validation Error: Keys are limited to a maximum of 10`
    );
  }

  for (const key of keys) {
    checkKey(key);
  }

  const storage = new Storage();
  const repository = context.repo.repo;
  let destination: string | undefined;

  try {
    const entry = await findCacheEntry(storage, keys, options.bucket!);
    if (!entry) return undefined;

    let method = entry.metadata.contentType;
    if (!method) {
      core.warning(`Cache entry ${entry.name} did not have a Content-Type set`);
      return undefined;
    }

    if (!method.startsWith(ContentTypePrefix)) {
      core.warning(`Cache entry ${entry.name} had unsupported Content-Type`);
      return undefined;
    }

    method = method.substring(ContentTypePrefix.length);
    if (method !== "zstd" && method !== "gzip") {
      core.warning(`Cache entry ${entry.name} had unsupported Content-Type`);
      return undefined;
    }

    if (!options.lookupOnly) {
      const tmpdir = await createTempDirectory();
      destination = `${tmpdir}/cache.tar.${method}`;

      await entry.download({ destination });

      await extractTar(destination);
    }

    // Strip off the `${repository}/` prefix on the cache object.
    return entry.name.substring(repository.length);
  } catch (e) {
    const error = e as Error;

    if (error.name === ValidationError.name) {
      throw error;
    } else {
      // Suppress all non-validation errors because caching should be optional
      core.warning(`Failed to restore: ${error.message}`);
    }
  } finally {
    try {
      if (destination) {
        await io.rmRF(destination);
      }
    } catch (e) {
      core.debug(`Failed to delete archive: ${e}`);
    }
  }
}

function checkKey(key: string): void {
  if (key.length > 512) {
    throw new ValidationError(
      `Key Validation Error: ${key} cannot be larger than 512 characters.`
    );
  }
}

async function getCompressionMethod(): Promise<"zstd" | "gzip"> {
  const versionOutput = await getZstdVersion();

  if (versionOutput === "") {
    return "gzip";
  } else {
    core.debug(`zstd version: ${versionOutput.trim()}`);
    return "zstd";
  }
}

async function getZstdVersion(): Promise<string> {
  let output = "";

  core.debug("Checking zstd --quiet --version");
  try {
    await exec.exec("zstd", ["--quiet", "--version"], {
      ignoreReturnCode: true,
      silent: true,
      listeners: {
        stdout: (data) => (output += data.toString()),
        stderr: (data) => (output += data.toString()),
      },
    });
  } catch (e) {
    core.debug(`${e}`);
  }

  return output;
}

async function findCacheEntry(
  storage: Storage,
  keys: string[],
  bucketName: string
): Promise<File | undefined> {
  const bucket = storage.bucket(bucketName);
  const repository = context.repo.repo;

  for (const key of keys) {
    const prefix = `${repository}/${key}`;
    const [files] = await bucket.getFiles({ prefix });

    if (files.length == 0) {
      continue;
    }

    // If there is an exact match then it should be the first returned result.
    if (files[0].name === prefix) return files[0];

    let newest = files[0];
    for (const file of files) {
      let ntime = new Date(newest.metadata.timeCreated || 0);
      let ftime = new Date(file.metadata.timeCreated || 0);

      if (ntime < ftime) newest = file;
    }

    return newest;
  }
}

async function createTempDirectory(): Promise<string> {
  let tempdir = process.env["RUNNER_TEMP"];

  if (!tempdir) {
    let baseloc: string;
    if (process.platform === "win32") {
      baseloc = process.env["USERPROFILE"] || "C:\\";
    } else if (process.platform === "darwin") {
      baseloc = "/Users";
    } else {
      baseloc = "/home";
    }

    tempdir = path.join(baseloc, "actions", "temp");
  }

  const dest = path.join(tempdir, crypto.randomUUID());
  await io.mkdirP(dest);
  return dest;
}

function getWorkingDirectory(): string {
  return process.env["GITHUB_WORKSPACE"] ?? process.cwd();
}

async function createTar(
  archive: string,
  tempdir: string,
  paths: string[],
  method: "zstd" | "gzip"
): Promise<void> {
  const manifest = path.join(tempdir, "manifest.txt");
  await writeFile(manifest, paths.join("\n"));

  const args = ["cf", archive, "--files-from", manifest];
  if (method === "gzip") {
    args.push("--gzip");
  } else {
    args.push("--zstd");
  }

  await exec.exec("tar", args);
}

async function extractTar(archive: string) {
  const workdir = getWorkingDirectory();
  await io.mkdirP(workdir);

  try {
    exec.exec("tar", ["xf", archive]);
  } catch (e) {
    throw new Error(`tar xf ${archive} failed with error: ${e}`);
  }
}

async function resolvePaths(patterns: string[]): Promise<string[]> {
  const paths: string[] = [];
  const workspace = getWorkingDirectory();
  const globber = await glob.create(patterns.join("\n"), {
    implicitDescendants: false,
  });

  for await (const file of globber.globGenerator()) {
    const relative = path
      .relative(workspace, file)
      .replace(new RegExp(`\\${path.sep}`, "g"), "/");

    core.debug(`Matched: ${relative}`);

    if (relative === "") {
      paths.push(".");
    } else {
      paths.push(relative);
    }
  }

  return paths;
}
