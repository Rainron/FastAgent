export function createLazyModuleLoader<T>(importModule: () => Promise<T>) {
  let modulePromise: Promise<T> | null = null
  return () => {
    modulePromise ??= importModule()
    return modulePromise
  }
}
