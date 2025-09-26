export type QAItem = { q: string; a: string };

/**
 * 统一的提示词模板，使用占位符：
 * - {x}: 前端问答汇总文本
 * - {instruction}: 附加的写作/生成指令（可选）
 */
export const PromptTemplates = {
  base: `下面是一个问答：
{x}

请你根据上面来生成回答`,
  withInstruction: `下面是一个问答：
{x}

请你根据上面的问答和下列指令生成回答：
{instruction}`,
} as const;

export const DEFAULT_INSTRUCTION = '请基于上面的问答，输出一个标准 XML 块描述人物设定，格式如下：\\n<characterProfile>\\n  <appearance><![CDATA[...]]></appearance>\\n  <preferences><![CDATA[...]]></preferences>\\n</characterProfile>\\n要求：\\n- 仅输出上述 XML 块，不要额外文字/解释/Markdown/标签以外内容；\\n- 使用中文；\\n- appearance 描述具体外貌（五官、体态、发色/服饰/神态等），50-120 字；\\n- preferences 描述偏好（饮食/颜色/音乐/爱好/禁忌/讨厌的事物等），50-120 字；\\n- 如需包含特殊符号，请置于 CDATA 中。';

// COMPLETE_ROLE_INSTRUCTION is now replaced by reading from game/random/人物生成.md file

/**
 * 将问答数组格式化为多行文本。
 * 例如：
 * Q1: xxx
 * A1: yyy
 * Q2: zzz
 * A2: www
 */
export function qaToText(qa: QAItem[]): string {
  const lines: string[] = [];
  qa.forEach((item, idx) => {
    const i = idx + 1;
    lines.push(`Q${i}: ${item.q.trim()}`);
    lines.push(`A${i}: ${item.a.trim()}`);
  });
  return lines.join('\n');
}

/**
 * 渲染模板：替换 {x} 与 {instruction} 占位符
 */
export function renderTemplate(template: string, vars: { x: string; instruction?: string }): string {
  let result = template.replace(/{x}/g, vars.x);
  if (vars.instruction !== undefined) {
    result = result.replace(/{instruction}/g, vars.instruction);
  }
  return result;
}

/**
 * 根据是否存在 instruction，选择模板并构造最终提示词
 * 返回：
 * - promptOnly: 仅问答汇总（x）
 * - finalPrompt: 以模板包裹后的最终提示词
 * - templateName: 实际使用的模板名
 * - templateRaw: 模板原文（便于存档/调试）
 */
export function buildFinalPrompt(qa: QAItem[], instruction?: string | null): {
  promptOnly: string;
  finalPrompt: string;
  templateName: keyof typeof PromptTemplates;
  templateRaw: string;
} {
  const x = qaToText(qa);
  const useInstruction = instruction && instruction.trim().length > 0;

  const templateName: keyof typeof PromptTemplates = useInstruction ? 'withInstruction' : 'base';
  const templateRaw = PromptTemplates[templateName];

  const finalPrompt = renderTemplate(templateRaw, {
    x,
    instruction: useInstruction ? instruction!.trim() : undefined,
  });

  return {
    promptOnly: x,
    finalPrompt,
    templateName,
    templateRaw,
  };
}