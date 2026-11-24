/** Display translations only. Never use these labels as genre identities or merge keys. */
const EN_LABELS: Record<string, string> = {
  流行: "Pop", 独立: "Indie", 爵士: "Jazz", 摇滚: "Rock", 电子: "Electronic", 民谣: "Folk",
  灵魂乐: "Soul", 嘻哈: "Hip-Hop", 未识别: "Unknown", 其他: "Other",
  "R&B/灵魂乐": "R&B / Soul", "另类/独立": "Alternative / Indie", "嘻哈/说唱": "Hip-Hop / Rap",
  嘻哈说唱: "Hip-Hop & Rap", 说唱: "Rap", 另类音乐: "Alternative", 电子音乐: "Electronic Music",
  欧美流行: "Western Pop", 华语流行: "Chinese Pop", 国语流行: "Mandopop", 国际流行: "International Pop",
  粤语流行: "Cantopop", 日本流行: "J-Pop", 法国流行: "French Pop", 独立流行: "Indie Pop",
  梦幻流行: "Dream Pop", 另类流行: "Alternative Pop", 合成器流行: "Synth-pop", 流行舞曲: "Dance-pop",
  "流行/摇滚": "Pop / Rock", 流行摇滚: "Pop Rock", 独立摇滚: "Indie Rock", 另类摇滚: "Alternative Rock",
  经典摇滚: "Classic Rock", 日系摇滚: "Japanese Rock", 英伦摇滚: "Britpop", 硬摇滚: "Hard Rock",
  软摇滚: "Soft Rock", 前卫摇滚: "Progressive Rock", 后摇: "Post-rock", 说唱摇滚: "Rap Rock",
  民谣摇滚: "Folk Rock", 朋克: "Punk", 流行朋克: "Pop Punk", 硬核朋克: "Hardcore Punk",
  情绪硬核: "Emo", 金属: "Metal", 新金属: "Nu Metal", 华语民谣: "Chinese Folk", 独立民谣: "Indie Folk",
  世界民谣: "World Folk", 世界音乐: "World Music", 乡村: "Country", 美式乡村: "American Country",
  乡村流行: "Country Pop", 唱作歌手: "Singer-Songwriter", 放克: "Funk", 雷鬼: "Reggae",
  中文说唱: "Chinese Rap", 流行说唱: "Pop Rap", 陷阱说唱: "Trap Rap", 情绪说唱: "Emo Rap",
  旋律说唱: "Melodic Rap", 爵士嘻哈: "Jazz Rap", 另类嘻哈: "Alternative Hip-Hop",
  低保真嘻哈: "Lo-fi Hip-Hop", 弛放嘻哈: "Chill Hip-Hop", 云雾说唱: "Cloud Rap",
  模糊说唱: "Mumble Rap", 孟菲斯说唱: "Memphis Rap", 南方说唱: "Southern Rap",
  硬核说唱: "Hardcore Rap", 意识说唱: "Conscious Rap", 快嘴说唱: "Fast Rap",
  拉丁饶舌: "Latin Rap", 说唱伴奏: "Rap Instrumentals", 毛刺嘻哈: "Glitch Hop",
  "当代R&B": "Contemporary R&B", "另类R&B": "Alternative R&B", 都市流行: "Urban Pop", 舞曲: "Dance", 浩室舞曲: "House",
  "House 作品": "House Works", 前卫浩室: "Progressive House", 深浩室舞曲: "Deep House",
  热带浩室舞曲: "Tropical House", 未来浩室: "Future House", 贝斯浩室舞曲: "Bass House",
  炸房浩室: "Big Room House", 街头浩室: "Ghetto House", 科技舞曲: "Techno",
  回响科技舞曲: "Dub Techno", 回响贝斯: "Dubstep", 旋律回响贝斯: "Melodic Dubstep",
  未来贝斯: "Future Bass", 未来弹跳: "Future Bounce", 墨尔本弹跳: "Melbourne Bounce",
  巴西贝斯: "Brazilian Bass", 弛放低音: "Chill Bass", 中速节奏: "Midtempo", 缓拍: "Downtempo",
  陷阱舞曲: "Trap", 鼓打贝斯: "Drum & Bass", "丛林/鼓打贝斯": "Jungle / Drum & Bass",
  合成器浪潮: "Synthwave", 低保真: "Lo-fi", 氛围音乐: "Ambient", 实验: "Experimental",
  轻音乐: "Easy Listening", 流行轻音乐: "Easy Listening Pop", 纯演奏音乐: "Instrumental",
  原声音乐: "Acoustic", 钢琴: "Piano", 古典: "Classical", 当代古典音乐: "Contemporary Classical",
  二十世纪古典: "20th-Century Classical", 古典主义时期: "Classical Period", 巴洛克时期: "Baroque",
  新古典主义音乐: "Neoclassical", 古典跨界: "Classical Crossover", 深度放克: "Deep Funk",
  新世纪: "New Age", 自然新世纪: "Nature New Age",
  自然环境声: "Nature Sounds", 声学噪声: "Acoustic Noise", 史诗音乐: "Epic Music",
  原声带: "Soundtrack", 电影原声: "Film Soundtrack", 电视剧原声: "TV Soundtrack",
  动画片原声: "Animation Soundtrack", 动漫原声: "Anime Soundtrack", 综艺原声: "Variety Show Soundtrack",
  游戏原声: "Game Soundtrack", 游戏音乐: "Game Music", 主机游戏配乐: "Console Game Score",
  游戏角色歌: "Game Character Songs", 配乐: "Score", 二次元: "ACG",
  国风: "Chinese-Inspired", 国风流行: "Chinese-Inspired Pop", 国风嘻哈: "Chinese-Inspired Hip-Hop",
  国风纯音乐: "Chinese-Inspired Instrumental", 拉丁音乐: "Latin", 基督教与福音: "Christian & Gospel",
  当代基督教音乐: "Contemporary Christian", 福音歌曲: "Gospel",
};

const ZH_LABELS: Record<string, string> = {
  "r&b": "R&B", pop: "流行", indie: "独立", jazz: "爵士", rock: "摇滚", electronic: "电子",
  folk: "民谣", soul: "灵魂乐", "hip-hop": "嘻哈", unknown: "未识别", unclassified: "未识别", other: "其他",
  "new age": "新世纪", "hair metal": "华丽金属", "classical crossover": "跨界古典",
  "j-pop": "日本流行", "k-pop": "韩国流行", downtempo: "缓拍", electronica: "电子音乐",
  "ballad pop": "抒情流行", house: "浩室舞曲", rap: "说唱", edm: "电子舞曲", "pop rap": "流行说唱",
  "pop rock": "流行摇滚", "jazz rap": "爵士嘻哈", "pb r&b": "另类 R&B",
  "west coast rap": "西海岸说唱", "emo rap": "情绪说唱", "dream pop": "梦幻流行",
};

export interface GenreDisplayLabels { zh: string; en: string }

/** Retains unrecognised wording rather than guessing a classification. */
export function genreDisplayLabels(name: string): GenreDisplayLabels {
  const original = name.trim();
  const directEnglish = Object.hasOwn(EN_LABELS, original) ? EN_LABELS[original] : undefined;
  const directChinese = Object.hasOwn(ZH_LABELS, original.toLowerCase()) ? ZH_LABELS[original.toLowerCase()] : undefined;
  if (directEnglish || directChinese) return { zh: directChinese ?? original, en: directEnglish ?? original };
  // Split provider hierarchies, including mixed labels such as R&B-灵魂乐.
  // English subgenre names such as Lo-fi or Hip-Hop remain intact.
  const hierarchy = /^([^\-–—]+)[\-–—](.+)$/.exec(original);
  if (hierarchy && (/[\u3400-\u9fff]/u.test(hierarchy[1])
    || (Object.hasOwn(ZH_LABELS, hierarchy[1].toLowerCase()) && /[\u3400-\u9fff]/u.test(hierarchy[2])))) {
    const parent = genreDisplayLabels(hierarchy[1]);
    const child = genreDisplayLabels(hierarchy[2]);
    return { zh: `${parent.zh} · ${child.zh}`, en: `${parent.en} · ${child.en}` };
  }
  return { zh: original, en: original };
}
