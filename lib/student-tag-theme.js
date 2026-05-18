function clean(value) {
  return String(value || "").trim();
}

function hashTagSeed(value) {
  const seed = clean(value);
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function getStudentTagTheme(tag) {
  const seed = clean(tag?.id) || clean(tag?.normalizedName) || clean(tag?.name);
  const hash = hashTagSeed(seed);
  const hue = hash % 360;
  const saturation = 60 + (hash % 18);
  const lightness = 90 + (hash % 4);
  const borderLightness = 78 + (hash % 6);
  const textLightness = 26 + (hash % 8);

  return {
    backgroundColor: `hsl(${hue} ${saturation}% ${lightness}%)`,
    borderColor: `hsl(${hue} ${Math.max(45, saturation - 10)}% ${borderLightness}%)`,
    color: `hsl(${hue} ${Math.max(40, saturation + 8)}% ${textLightness}%)`
  };
}
