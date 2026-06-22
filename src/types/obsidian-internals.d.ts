import "obsidian";

declare module "obsidian" {
  interface App {
    setting?: {
      open(): void;
      close(): void;
      openTabById(id: string): void;
      activeTab?:
        | {
            constructor?: { name?: string };
            display?: () => void;
          }
        | null;
    };
    plugins?: {
      disablePlugin?: (id: string) => Promise<void>;
      enabledPlugins?: Set<string>;
      plugins?: Record<string, { settings?: unknown } | undefined>;
      getPlugin?: (id: string) => { settings?: unknown } | null;
    };
  }
}

