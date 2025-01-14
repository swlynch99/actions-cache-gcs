import { ConfigUnsetError } from "./error";

interface CommonOptions {
  /**
   * The GCS bucket used to store cache entries.
   *
   * If not set this will default to the value of the `ACTIONS_GCS_CACHE_BUCKET`
   * environment variable.
   *
   * If still unset then an error will be thrown.
   */
  bucket?: string;
}

export interface UploadOptions extends CommonOptions {}

export interface DownloadOptions extends CommonOptions {
  /**
   * Whether to skip downloading the cache entry.
   *
   * If lookupOnly is set to true, the restore function will only check if a matching
   * cache entry exists and return the cache key if it does.
   *
   * @default false
   */
  lookupOnly?: boolean;
}

function getCommonOptions(base?: CommonOptions): CommonOptions {
  const options = base || {};

  if (options.bucket === undefined) {
    const value = process.env["ACTIONS_GCS_CACHE_BUCKET"];

    if (!value) {
      throw new ConfigUnsetError(
        "Config Error: no bucket value provided and ACTIONS_GCS_CACHE_BUCKET environment variable is unset"
      );
    }

    options.bucket = value;
  }

  return options;
}

export function getUploadOptions(base?: UploadOptions): UploadOptions {
  return getCommonOptions(base) as UploadOptions;
}

export function getDownloadOptions(base?: DownloadOptions): DownloadOptions {
  const options = getCommonOptions(base) as DownloadOptions;

  if (options.lookupOnly === undefined) {
    options.lookupOnly = false;
  }

  return options;
}
