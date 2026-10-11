// Just enough of the `obsidian` module for AiProviderService, prompts and EnhanceDictionaryService to run under Node.
// Everything else the plugin imports from obsidian is UI and never reaches this bundle.
export const Platform = { isMobile: false, isIosApp: false, isAndroidApp: false };
export const normalizePath = (p) => p;
export class Notice {
  constructor() {}
  setMessage() {}
  hide() {}
}
export async function requestUrl() {
  throw new Error("requestUrl is not available in the eval harness (Platform.isMobile is false)");
}
