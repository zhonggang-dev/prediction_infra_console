export interface ResolutionRuleSection {
  key: string;
  title: string;
  content: string;
}

const ruleMarkers = [
  ["Authority", "权威来源"],
  ["Metric definition", "指标定义"],
  ["Units", "单位与舍入"],
  ["Rounding", "舍入规则"],
  ["Vintage policy", "数据版本口径"],
  ["Mapping to displayed options", "选项映射"],
  ["Boundary rule", "边界规则"],
  ["Delayed publication", "延迟发布处理"],
  ["Hard stop", "最终停止条件"],
] as const;

const markerTitles = new Map(ruleMarkers.map(([marker, title]) => [marker.toLowerCase(), title]));
const markerPattern = new RegExp(`(?:^|\\s)(${ruleMarkers.map(([marker]) => escapePattern(marker)).join("|")}):\\s*`, "gi");

/** 将 QA 的稳定规则标识拆为展示段落；无法识别时只按句子换行，不改写正文。 */
export function formatResolutionRules(value: string): ResolutionRuleSection[] {
  const text = value.trim();
  if (!text) return [];
  const matches = [...text.matchAll(markerPattern)];
  if (!matches.length) {
    return splitSentences(text).map((content, index) => ({ key: `paragraph-${index}`, title: "", content }));
  }

  const sections: ResolutionRuleSection[] = [];
  const firstIndex = matches[0].index ?? 0;
  const preface = text.slice(0, firstIndex).trim();
  if (preface) sections.push({ key: "preface", title: "说明", content: preface });
  matches.forEach((match, index) => {
    const marker = match[1];
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index ?? text.length : text.length;
    const content = text.slice(start, end).trim();
    if (content) sections.push({ key: `${marker}-${index}`, title: markerTitles.get(marker.toLowerCase()) ?? marker, content });
  });
  return sections;
}

function splitSentences(value: string): string[] {
  return value.split(/(?<=[.;。；])\s+/u).map((part) => part.trim()).filter(Boolean);
}

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
