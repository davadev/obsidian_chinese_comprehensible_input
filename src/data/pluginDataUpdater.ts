export type PluginDataBlob = Record<string, any>;

export type PluginDataMutation = (
  blob: PluginDataBlob
) => void | Promise<void>;

export function createQueuedDataBlobUpdater(
  loadData: () => Promise<PluginDataBlob | null | undefined>,
  saveData: (blob: PluginDataBlob) => Promise<void>
): (mutate: PluginDataMutation) => Promise<void> {
  let tail: Promise<void> = Promise.resolve();

  return async (mutate: PluginDataMutation): Promise<void> => {
    const run = tail.catch(() => {}).then(async () => {
      const blob = (await loadData()) ?? {};
      await mutate(blob);
      await saveData(blob);
    });
    tail = run;
    await run;
  };
}
