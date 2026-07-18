const MAX_REFERENCE_DATA_URL_LENGTH = 1_500_000;
const optimizedCache = new Map<string, Promise<string>>();

const loadImage = (dataUrl: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error("主场景参考图无法压缩"));
  image.src = dataUrl;
});

const compress = async (dataUrl: string) => {
  if (!dataUrl.startsWith("data:image/") || dataUrl.length <= MAX_REFERENCE_DATA_URL_LENGTH) return dataUrl;
  const image = await loadImage(dataUrl);
  const attempts = [
    { maxSide: 1280, quality: 0.82 },
    { maxSide: 1024, quality: 0.76 },
    { maxSide: 896, quality: 0.7 },
    { maxSide: 768, quality: 0.64 }
  ];
  let smallest = dataUrl;
  for (const attempt of attempts) {
    const scale = Math.min(1, attempt.maxSide / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    const candidate = canvas.toDataURL("image/jpeg", attempt.quality);
    if (candidate.length < smallest.length) smallest = candidate;
    if (candidate.length <= MAX_REFERENCE_DATA_URL_LENGTH) return candidate;
  }
  return smallest;
};

export const optimizeReferenceImageDataUrl = (dataUrl: string): Promise<string> => {
  if (!optimizedCache.has(dataUrl)) optimizedCache.set(dataUrl, compress(dataUrl));
  return optimizedCache.get(dataUrl)!;
};
