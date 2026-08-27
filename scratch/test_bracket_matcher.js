function extractJsonArray(text, key) {
  const keyIdx = text.indexOf(key);
  if (keyIdx === -1) return null;

  const startIdx = text.indexOf('[', keyIdx + key.length);
  if (startIdx === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIdx; i < text.length; i++) {
    const char = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === '\\') {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '[') depth++;
      else if (char === ']') {
        depth--;
        if (depth === 0) {
          const jsonStr = text.substring(startIdx, i + 1);
          try {
            return JSON.parse(jsonStr);
          } catch (e) {
            return null;
          }
        }
      }
    }
  }

  return null;
}

// 测试用例
const sample = 'var ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[{"baseUrl":"https://www.youtube.com/api/timedtext?v=123","name":{"runs":[{"text":"English (auto-generated)"}]},"vssId":"a.en","languageCode":"en","kind":"asr"}]}}};';

const result = extractJsonArray(sample, '"captionTracks"');
console.log("Parsed tracks count:", result ? result.length : 0);
if (result && result[0]) {
  console.log("Track language:", result[0].languageCode);
  console.log("Track name:", result[0].name.runs[0].text);
  console.log("Track url:", result[0].baseUrl);
}
