export const PLUGIN_ID = "chinese-comprehensible-input";
export const VIEW_TYPE_CHINESE = "cci-chinese-view";
export const VIEW_TYPE_STATS = "cci-stats-view";
export const DATA_SCHEMA_VERSION = 1;
export const GENERATED_NOTES_FOLDER_DEFAULT = "Chinese Learning/Generated";
export const VOCAB_MIRROR_PATH_DEFAULT = "Chinese Learning/vocabulary.json";
export const DICTIONARY_DATA_FOLDER = "_dictionary";
/** Reverse-lookup index built from ECDICT's English→Chinese translation
 *  field. Dotfile at vault root so remotely-save's default ignore list
 *  excludes it from sync — each device downloads its own copy. */
export const ECDICT_OUTPUT_PATH = ".cci-ecdict.json";
/** Full ECDICT (~65MB CSV, ~770k rows). Hosted in the repo's master branch
 *  as a raw file — GitHub serves it as text/plain HTTP 200. The "mini"
 *  file in that repo is only ~50 sample rows and useless for real
 *  reverse-lookup. Release-asset variants ship as .7z which browsers
 *  cannot decompress natively. */
export const ECDICT_CSV_URL =
  "https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv";
