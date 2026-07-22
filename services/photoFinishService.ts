import type { ImageGeneration, PhotoFinishLevel } from "../domain/productWorkflow";

interface PhotoFinishDependencies {
  loadImage: (dataUrl: string) => Promise<HTMLImageElement>;
  createCanvas: () => HTMLCanvasElement;
}

const defaultDependencies: PhotoFinishDependencies = {
  loadImage: dataUrl => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片解码失败"));
    image.src = dataUrl;
  }),
  createCanvas: () => document.createElement("canvas")
};

const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

const finishPixels = (data: Uint8ClampedArray, level: Exclude<PhotoFinishLevel, "off">) => {
  const natural = level === "natural";
  for (let index = 0; index < data.length; index += 4) {
    const grain = (((index / 4) * 17 + 11) % 7 - 3) * (natural ? 0.55 : 0.35);
    const contrast = natural ? 0.985 : 0.99;
    const tone = (channel: number) => (channel - 128) * contrast + 128 + grain;
    data[index] = clamp(tone(data[index]) + (natural ? 1.8 : 0.5));
    data[index + 1] = clamp(tone(data[index + 1]) + (natural ? 0.8 : 0));
    data[index + 2] = clamp(tone(data[index + 2]) - (natural ? 1.2 : 0.3));
  }
};

export const applyPhotoFinish = async (
  dataUrl: string,
  level: PhotoFinishLevel,
  dependencies: PhotoFinishDependencies = defaultDependencies
): Promise<string> => {
  if (level === "off") return dataUrl;
  try {
    const image = await dependencies.loadImage(dataUrl);
    const canvas = dependencies.createCanvas();
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return dataUrl;
    context.drawImage(image, 0, 0, image.width, image.height);
    const imageData = context.getImageData(0, 0, image.width, image.height);
    finishPixels(imageData.data, level);
    context.putImageData(imageData, 0, 0);
    return canvas.toDataURL("image/jpeg", level === "natural" ? 0.92 : 0.94);
  } catch {
    return dataUrl;
  }
};

export const preferredImageUrl = (job: ImageGeneration) => job.finishedResultUrl || job.resultUrl;
