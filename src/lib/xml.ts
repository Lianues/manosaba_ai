export type CharacterXML = {
  appearance: string;
  preferences: string;
};

export type OutlineXML = {
  premise: string;
  beats: string[];
};

export type StoryXML = {
  title: string;
  content: string;
};

function stripCData(s: string): string {
  return s
    .replace(/<!\[CDATA\[/g, '')
    .replace(/\]\]>/g, '');
}

function innerText(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = xml.match(re);
  if (!m) return null;
  return stripCData(m[1]).trim();
}

function innerTexts(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out.push(stripCData(m[1]).trim());
  }
  return out;
}

/**
 * 解析标准 XML（严格要求）:
 * <characterProfile>
 *   <appearance>...</appearance>
 *   <preferences>...</preferences>
 * </characterProfile>
 *
 * 宽松兼容：允许存在多余空白/换行、CDATA 包裹
 * 不允许：缺失标签或无文本时将返回 null
 */
export function parseCharacterXml(xml: string): CharacterXML | null {
  if (typeof xml !== 'string' || !xml.trim()) return null;

  // 可选：先尝试定位根节点，减少误匹配
  const rootMatch = xml.match(/<characterProfile\b[^>]*>([\s\S]*?)<\/characterProfile>/i);
  const scope = rootMatch ? rootMatch[1] : xml;

  const appearance = innerText(scope, 'appearance');
  const preferences = innerText(scope, 'preferences');

  if (!appearance || !preferences) return null;

  return { appearance, preferences };
}

/**
 * 组装后续提示词结构
 * 人物外貌：
 * {}
 * 人物喜好：
 * {}
 */
export function composeProfilePrompt(extracted: CharacterXML): string {
  const { appearance, preferences } = extracted;
  return [
    '人物外貌：',
    `{${appearance}}`,
    '',
    '人物喜好：',
    `{${preferences}}`,
  ].join('\n');
}

/**
 * 解析故事大纲 XML：
 * <storyOutline>
 *   <premise><![CDATA[...]]></premise>
 *   <beats>
 *     <beat><![CDATA[...]]></beat>
 *     ...
 *   </beats>
 * </storyOutline>
 */
export function parseStoryOutlineXml(xml: string): OutlineXML | null {
  if (typeof xml !== 'string' || !xml.trim()) return null;
  const rootMatch = xml.match(/<storyOutline\b[^>]*>([\s\S]*?)<\/storyOutline>/i);
  const scope = rootMatch ? rootMatch[1] : xml;

  const premise = innerText(scope, 'premise') ?? '';
  const beats = innerTexts(scope, 'beat');

  if (!premise || beats.length === 0) return null;
  return { premise, beats };
}
export type FullOutlineSection = {
  sectionTitle: string;
  summary: string;
};

export type FullOutlineChapter = {
  chapterTitle: string;
  sections: FullOutlineSection[];
};

export type FullOutlineXML = {
  title: string;
  premise: string;
  chapters: FullOutlineChapter[];
  ending?: string;
};

function matchBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out.push(m[1]);
  }
  return out;
}

/**
 * 解析“完整大纲” XML（符合 game/workflow/生成大纲提示词.md 的结构）：
 * <storyOutline>
 *   <title><![CDATA[...]]></title>
 *   <premise><![CDATA[...]]></premise>
 *   <chapters>
 *     <chapter>
 *       <chapterTitle><![CDATA[...]]></chapterTitle>
 *       <sections>
 *         <section>
 *           <sectionTitle><![CDATA[...]]></sectionTitle>
 *           <summary><![CDATA[...]]></summary>
 *         </section>
 *         ...
 *       </sections>
 *     </chapter>
 *     ...
 *   </chapters>
 *   <ending><![CDATA[...]]></ending>
 * </storyOutline>
 */
export function parseFullStoryOutlineXml(xml: string): FullOutlineXML | null {
  if (typeof xml !== 'string' || !xml.trim()) return null;

  const rootMatch = xml.match(/<storyOutline\b[^>]*>([\s\S]*?)<\/storyOutline>/i);
  const scope = rootMatch ? rootMatch[1] : xml;

  const title = innerText(scope, 'title') ?? '';
  const premise = innerText(scope, 'premise') ?? '';
  const ending = innerText(scope, 'ending') ?? undefined;

  // 章节块
  const chaptersScopeMatch = scope.match(/<chapters\b[^>]*>([\s\S]*?)<\/chapters>/i);
  const chaptersScope = chaptersScopeMatch ? chaptersScopeMatch[1] : scope;
  const chapterBlocks = matchBlocks(chaptersScope, 'chapter');

  const chapters: FullOutlineChapter[] = [];

  for (const chapterXml of chapterBlocks) {
    const chapterTitle = innerText(chapterXml, 'chapterTitle') ?? '';

    // sections 容器
    const sectionsScopeMatch = chapterXml.match(/<sections\b[^>]*>([\s\S]*?)<\/sections>/i);
    const sectionsScope = sectionsScopeMatch ? sectionsScopeMatch[1] : chapterXml;
    const sectionBlocks = matchBlocks(sectionsScope, 'section');

    const sections: FullOutlineSection[] = sectionBlocks
      .map((secXml) => {
        const sectionTitle = innerText(secXml, 'sectionTitle') ?? '';
        const summary = innerText(secXml, 'summary') ?? '';
        return { sectionTitle, summary };
      })
      .filter((s) => s.sectionTitle && s.summary);

    if (chapterTitle && sections.length > 0) {
      chapters.push({ chapterTitle, sections });
    }
  }

  if (!premise || chapters.length === 0) return null;

  return {
    title,
    premise,
    chapters,
    ending,
  };
}

/**
 * 将"人物外貌/喜好"块与"大纲"组合为新的提示词块：
 * 人物外貌：
 * {}
 *
 * 人物喜好：
 * {}
 *
 * 故事大纲：
 * {前提：... 
 * 1. ...
 * 2. ...
 * ...}
 */
export function composeOutlineAppendPrompt(profilePrompt: string, outline: OutlineXML): string {
  const beatsText = outline.beats.map((b, i) => `${i + 1}. ${b}`).join('\n');
  const outlineBlock = `{前提：${outline.premise}\n${beatsText}}`;
  return [
    profilePrompt,
    '',
    '故事大纲：',
    outlineBlock,
  ].join('\n');
}

/**
 * 解析最终故事 XML：
 * <story>
 *   <title><![CDATA[...]]></title>
 *   <content><![CDATA[...]]></content>
 * </story>
 */
export function parseStoryXml(xml: string): StoryXML | null {
  if (typeof xml !== 'string' || !xml.trim()) return null;
  const rootMatch = xml.match(/<story\b[^>]*>([\s\S]*?)<\/story>/i);
  const scope = rootMatch ? rootMatch[1] : xml;

  const title = innerText(scope, 'title') ?? '';
  const content = innerText(scope, 'content') ?? '';
  if (!content) return null;
  return { title, content };
}