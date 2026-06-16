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
  }
}
