# @swlynch99/actions-cache-gcs

This package provides an interface that is mostly compatible with the `@actions/cache`
NPM package but instead uses a GCS bucket to store the artifacts.

## Configuration
This library uses two pieces of external configuration, depending on its setup:
- GCS credentials are read via Application Default Credentials
- The bucket to use is taken from the `ACTIONS_CACHE_GCS_BUCKET` environment
  variable, if not provided as an option.

## API

This package exposes the following API. It roughly mirrors that exported by the
`@actions/cache` package although it only supports a subset of the options.
```typescript
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

/**
 * isFeatureAvailable checks whether the cache service is available.
 *
 * @returns true - with the right configuration it should always be possible to
 *          use GCS as a cache.
 */
export declare function isFeatureAvailable(): boolean;

/**
 * Saves a list of files with the specified key.
 *
 * @param paths a list of file paths to be cached
 * @param key an explicit key for restoring the cache
 * @param options cache upload options
 * @throws an error if the save fails
 */
export declare function saveCache(
  paths: string[],
  key: string,
  options?: UploadOptions
): Promise<void>;

/**
 * Restores cache from keys.
 *
 * @param paths a list of file paths to restore from the cache.
 * @param primaryKey and explicit key for restoring from the cache. Lookup is done with prefix matching.
 * @param restoreKeys an optional ordered list of keys to use for restoring the cache if no cache hit occurred for primaryKey.
 * @param options cache download options.
 */
export declare function restoreCache(
  paths: string[],
  primaryKey: string,
  restoreKeys?: string[],
  options?: DownloadOptions
): Promise<string | undefined>;
```
