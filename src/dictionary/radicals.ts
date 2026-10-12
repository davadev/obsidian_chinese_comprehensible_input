import { RADICAL_FIRST_CODE_POINT, RADICAL_NUMBERS_B64, RADICAL_SIMPLIFIED_B64 } from "./radicalMap.generated";

/** The 214 Kangxi radicals, in order (number 1 is index 0): the character and a short English name. */
const KANGXI: Array<[string, string]> = [
  ["一", "one"], ["丨", "line"], ["丶", "dot"], ["丿", "slash"], ["乙", "second"], ["亅", "hook"], ["二", "two"], ["亠", "lid"],
  ["人", "person"], ["儿", "legs"], ["入", "enter"], ["八", "eight"], ["冂", "down box"], ["冖", "cover"], ["冫", "ice"], ["几", "table"],
  ["凵", "open box"], ["刀", "knife"], ["力", "power"], ["勹", "wrap"], ["匕", "spoon"], ["匚", "right open box"], ["匸", "hiding enclosure"], ["十", "ten"],
  ["卜", "divination"], ["卩", "seal"], ["厂", "cliff"], ["厶", "private"], ["又", "again"], ["口", "mouth"], ["囗", "enclosure"], ["土", "earth"],
  ["士", "scholar"], ["夂", "go"], ["夊", "go slowly"], ["夕", "evening"], ["大", "big"], ["女", "woman"], ["子", "child"], ["宀", "roof"],
  ["寸", "inch"], ["小", "small"], ["尢", "lame"], ["尸", "corpse"], ["屮", "sprout"], ["山", "mountain"], ["川", "river"], ["工", "work"],
  ["己", "oneself"], ["巾", "cloth"], ["干", "dry"], ["幺", "short thread"], ["广", "dotted cliff"], ["廴", "long stride"], ["廾", "two hands"], ["弋", "shoot"],
  ["弓", "bow"], ["彐", "snout"], ["彡", "bristle"], ["彳", "step"], ["心", "heart"], ["戈", "spear"], ["戶", "door"], ["手", "hand"],
  ["支", "branch"], ["攴", "rap"], ["文", "script"], ["斗", "dipper"], ["斤", "axe"], ["方", "square"], ["无", "not"], ["日", "sun"],
  ["曰", "say"], ["月", "moon"], ["木", "tree"], ["欠", "lack"], ["止", "stop"], ["歹", "death"], ["殳", "weapon"], ["毋", "do not"],
  ["比", "compare"], ["毛", "fur"], ["氏", "clan"], ["气", "steam"], ["水", "water"], ["火", "fire"], ["爪", "claw"], ["父", "father"],
  ["爻", "trigrams"], ["爿", "split wood"], ["片", "slice"], ["牙", "fang"], ["牛", "cow"], ["犬", "dog"], ["玄", "profound"], ["玉", "jade"],
  ["瓜", "melon"], ["瓦", "tile"], ["甘", "sweet"], ["生", "life"], ["用", "use"], ["田", "field"], ["疋", "bolt of cloth"], ["疒", "sickness"],
  ["癶", "footsteps"], ["白", "white"], ["皮", "skin"], ["皿", "dish"], ["目", "eye"], ["矛", "spear"], ["矢", "arrow"], ["石", "stone"],
  ["示", "spirit"], ["禸", "track"], ["禾", "grain"], ["穴", "cave"], ["立", "stand"], ["竹", "bamboo"], ["米", "rice"], ["糸", "silk"],
  ["缶", "jar"], ["网", "net"], ["羊", "sheep"], ["羽", "feather"], ["老", "old"], ["而", "and"], ["耒", "plow"], ["耳", "ear"],
  ["聿", "brush"], ["肉", "meat"], ["臣", "minister"], ["自", "self"], ["至", "arrive"], ["臼", "mortar"], ["舌", "tongue"], ["舛", "oppose"],
  ["舟", "boat"], ["艮", "stopping"], ["色", "color"], ["艸", "grass"], ["虍", "tiger"], ["虫", "insect"], ["血", "blood"], ["行", "walk"],
  ["衣", "clothes"], ["襾", "cover"], ["見", "see"], ["角", "horn"], ["言", "speech"], ["谷", "valley"], ["豆", "bean"], ["豕", "pig"],
  ["豸", "badger"], ["貝", "shell"], ["赤", "red"], ["走", "run"], ["足", "foot"], ["身", "body"], ["車", "cart"], ["辛", "bitter"],
  ["辰", "morning"], ["辵", "walk"], ["邑", "city"], ["酉", "wine"], ["釆", "distinguish"], ["里", "village"], ["金", "gold"], ["長", "long"],
  ["門", "gate"], ["阜", "mound"], ["隶", "slave"], ["隹", "short-tailed bird"], ["雨", "rain"], ["青", "blue-green"], ["非", "wrong"], ["面", "face"],
  ["革", "leather"], ["韋", "tanned leather"], ["韭", "leek"], ["音", "sound"], ["頁", "page"], ["風", "wind"], ["飛", "fly"], ["食", "eat"],
  ["首", "head"], ["香", "fragrant"], ["馬", "horse"], ["骨", "bone"], ["高", "tall"], ["髟", "hair"], ["鬥", "fight"], ["鬯", "sacrificial wine"],
  ["鬲", "cauldron"], ["鬼", "ghost"], ["魚", "fish"], ["鳥", "bird"], ["鹵", "salt"], ["鹿", "deer"], ["麥", "wheat"], ["麻", "hemp"],
  ["黃", "yellow"], ["黍", "millet"], ["黑", "black"], ["黹", "embroidery"], ["黽", "frog"], ["鼎", "tripod"], ["鼓", "drum"], ["鼠", "rat"],
  ["鼻", "nose"], ["齊", "even"], ["齒", "tooth"], ["龍", "dragon"], ["龜", "turtle"], ["龠", "flute"],
];

/** The simplified forms of the radicals a simplified character can carry (Unihan marks them with an apostrophe). */
const SIMPLIFIED_FORM: Record<number, string> = {
  90: "丬", 120: "纟", 147: "见", 149: "讠", 154: "贝", 159: "车", 167: "钅", 168: "长", 169: "门", 178: "韦", 181: "页", 182: "风",
  183: "飞", 184: "饣", 187: "马", 195: "鱼", 196: "鸟", 197: "卤", 199: "麦", 205: "黾", 208: "鼡", 210: "齐", 211: "齿", 212: "龙", 213: "龟",
};

/** Radicals that are written differently beside other parts (氵 for 水): shown with the full form first, "水 / 氵". */
const WRITTEN_BESIDE: Record<number, string> = { 9: "亻", 18: "刂", 61: "忄", 64: "扌", 66: "攵", 85: "氵", 86: "灬", 87: "爫", 93: "牜", 94: "犭", 96: "王", 113: "礻", 122: "罒", 145: "衤" };
/** Radicals whose Kangxi form is rarely seen in print: show the form learners actually meet. */
const SHOWN_AS: Record<number, string> = { 140: "艹", 162: "辶", 163: "阝", 170: "阝" };

let numbers: Uint8Array | null = null;
let simplifiedBits: Uint8Array | null = null;

function decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * The Kangxi radical of one character, from Unicode's Unihan data, as "目 (eye)" (a simplified character shows the
 * simplified form of its radical: "讠 (speech)"). Empty when the character is not in the data (anything outside the
 * common CJK block) or is not a single character. It is a lookup, never a guess: the radical is a fact the plugin can
 * state, unlike how the character was historically built.
 */
export function radicalOf(char: string): string {
  const cp = char.codePointAt(0);
  if (cp === undefined || char.length !== String.fromCodePoint(cp).length) return "";
  const i = cp - RADICAL_FIRST_CODE_POINT;
  numbers ??= decode(RADICAL_NUMBERS_B64);
  if (i < 0 || i >= numbers.length) return "";
  const n = numbers[i];
  const entry = KANGXI[n - 1];
  if (!entry) return "";
  simplifiedBits ??= decode(RADICAL_SIMPLIFIED_B64);
  const isSimplified = (simplifiedBits[i >> 3] & (1 << (i & 7))) !== 0;
  const [kangxi, name] = entry;
  const simplified = isSimplified ? SIMPLIFIED_FORM[n] : undefined;
  const form = simplified ?? SHOWN_AS[n] ?? (WRITTEN_BESIDE[n] ? `${kangxi} / ${WRITTEN_BESIDE[n]}` : kangxi);
  return `${form} (${name})`;
}
