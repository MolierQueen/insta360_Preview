"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const API = "http://127.0.0.1:8765";
const PAGE_SIZE = 300;
const FRAME_EXPORT_KEY = "insta-library-frame-export";
const HDR_FORMAT_KEY = "insta-library-hdr-format";
const FRAMEABLE_PHOTO_EXTENSIONS = new Set(["jpg", "jpeg", "insp"]);

type CameraStatus = {
  connected: boolean;
  camera_host: string;
  connected_at: string | null;
  last_error: string | null;
  file_count: number;
  counts: { photo: number; video: number; other: number };
  read_only: boolean;
  list_source: "not_loaded" | "http_directory" | "osc_paginated" | "ucd2_paginated" | "ucd2_fixed_pages";
  list_truncated: boolean;
  verified_ucd2_limit: number;
};

type CameraFile = {
  path: string;
  name: string;
  extension: string;
  kind: "photo" | "video" | "other";
  captured_at: string | null;
  media_url: string;
  download_url: string;
  thumbnail_url: string;
  is_proxy: boolean;
  proxy_path?: string;
};

type FramedPhotoDetails = {
  capturedAt: string | null;
  hdrFormat: "apple" | "universal";
};

type FramedPhotoExport = {
  blob: Blob;
  extension: "png" | "jpg" | "heic";
};

type ExposureMetadata = {
  aperture: number | null;
  shutterSeconds: number | null;
  iso: number | null;
};

const emptyStatus: CameraStatus = {
  connected: false,
  camera_host: "192.168.42.1",
  connected_at: null,
  last_error: null,
  file_count: 0,
  counts: { photo: 0, video: 0, other: 0 },
  read_only: true,
  list_source: "not_loaded",
  list_truncated: false,
  verified_ucd2_limit: 1000,
};

function endpoint(path: string) {
  return `${API}${path}`;
}

function formatDate(value: string | null) {
  if (!value) return "未知日期";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function dayKey(file: CameraFile) {
  return file.captured_at?.slice(0, 10) || "unknown";
}

function formatDay(value: string) {
  if (value === "unknown") return "日期未知";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${value}T12:00:00`));
}

function frameablePhoto(file: CameraFile) {
  return file.kind === "photo" && FRAMEABLE_PHOTO_EXTENSIONS.has(file.extension);
}

function exportDate(value: string | null) {
  if (!value) return "CAPTURE TIME UNKNOWN";
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "--";
  return `${part("year")} · ${part("month")} · ${part("day")}   ${part("hour")}:${part("minute")}`;
}

function parseExifExposure(buffer: ArrayBuffer): ExposureMetadata {
  const empty = { aperture: null, shutterSeconds: null, iso: null };
  const view = new DataView(buffer);
  if (view.byteLength < 12 || view.getUint16(0, false) !== 0xffd8) return empty;

  let tiffStart = -1;
  let markerOffset = 2;
  while (markerOffset + 4 <= view.byteLength) {
    if (view.getUint8(markerOffset) !== 0xff) {
      markerOffset += 1;
      continue;
    }
    const marker = view.getUint8(markerOffset + 1);
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      markerOffset += 2;
      continue;
    }
    const segmentLength = view.getUint16(markerOffset + 2, false);
    if (segmentLength < 2 || markerOffset + 2 + segmentLength > view.byteLength) break;
    if (
      marker === 0xe1 && segmentLength >= 8 &&
      view.getUint8(markerOffset + 4) === 0x45 &&
      view.getUint8(markerOffset + 5) === 0x78 &&
      view.getUint8(markerOffset + 6) === 0x69 &&
      view.getUint8(markerOffset + 7) === 0x66 &&
      view.getUint16(markerOffset + 8, false) === 0
    ) {
      tiffStart = markerOffset + 10;
      break;
    }
    markerOffset += segmentLength + 2;
  }
  if (tiffStart < 0 || tiffStart + 8 > view.byteLength) return empty;

  const byteOrder = view.getUint16(tiffStart, false);
  if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return empty;
  const littleEndian = byteOrder === 0x4949;
  const inBounds = (offset: number, length: number) => offset >= 0 && offset + length <= view.byteLength;
  const read16 = (offset: number) => view.getUint16(offset, littleEndian);
  const read32 = (offset: number) => view.getUint32(offset, littleEndian);

  function readEntryValue(entry: number, type: number, count: number) {
    const sizes: Record<number, number> = { 1: 1, 3: 2, 4: 4, 5: 8, 9: 4, 10: 8 };
    const unitSize = sizes[type];
    if (!unitSize || count < 1) return null;
    const byteLength = unitSize * count;
    const valueOffset = byteLength <= 4 ? entry + 8 : tiffStart + read32(entry + 8);
    if (!inBounds(valueOffset, unitSize)) return null;
    if (type === 1) return view.getUint8(valueOffset);
    if (type === 3) return read16(valueOffset);
    if (type === 4) return read32(valueOffset);
    if (type === 9) return view.getInt32(valueOffset, littleEndian);
    if (type === 5 || type === 10) {
      if (!inBounds(valueOffset, 8)) return null;
      const numerator = type === 5 ? read32(valueOffset) : view.getInt32(valueOffset, littleEndian);
      const denominator = type === 5 ? read32(valueOffset + 4) : view.getInt32(valueOffset + 4, littleEndian);
      return denominator ? numerator / denominator : null;
    }
    return null;
  }

  function readIfd(relativeOffset: number) {
    const values = new Map<number, number>();
    const start = tiffStart + relativeOffset;
    if (!inBounds(start, 2)) return values;
    const count = read16(start);
    for (let index = 0; index < count; index += 1) {
      const entry = start + 2 + index * 12;
      if (!inBounds(entry, 12)) break;
      const value = readEntryValue(entry, read16(entry + 2), read32(entry + 4));
      if (value !== null && Number.isFinite(value)) values.set(read16(entry), value);
    }
    return values;
  }

  try {
    const ifd0Offset = read32(tiffStart + 4);
    const ifd0 = readIfd(ifd0Offset);
    const exifOffset = ifd0.get(0x8769);
    if (exifOffset === undefined) return empty;
    const exif = readIfd(exifOffset);
    const directAperture = exif.get(0x829d);
    const apexAperture = exif.get(0x9202);
    const directShutter = exif.get(0x829a);
    const apexShutter = exif.get(0x9201);
    return {
      aperture: directAperture ?? (apexAperture !== undefined ? 2 ** (apexAperture / 2) : null),
      shutterSeconds: directShutter ?? (apexShutter !== undefined ? 2 ** (-apexShutter) : null),
      iso: exif.get(0x8833) ?? exif.get(0x8827) ?? null,
    };
  } catch {
    return empty;
  }
}

async function readExposureMetadata(blob: Blob) {
  try {
    const header = await blob.slice(0, Math.min(blob.size, 1024 * 1024)).arrayBuffer();
    return parseExifExposure(header);
  } catch {
    return { aperture: null, shutterSeconds: null, iso: null };
  }
}

function exposureLine(metadata: ExposureMetadata) {
  const aperture = metadata.aperture && metadata.aperture > 0
    ? `F/${metadata.aperture.toFixed(1)}`
    : "F/—";
  let shutter = "—";
  if (metadata.shutterSeconds && metadata.shutterSeconds > 0) {
    shutter = metadata.shutterSeconds < 1
      ? `1/${Math.max(1, Math.round(1 / metadata.shutterSeconds))}`
      : `${Number(metadata.shutterSeconds.toFixed(1))}s`;
  }
  const iso = metadata.iso && metadata.iso > 0 ? `ISO${Math.round(metadata.iso)}` : "ISO—";
  return `${aperture}   ${shutter}   ${iso}`;
}

function loadImage(blob: Blob) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("浏览器无法解码这张照片"));
    };
    image.src = url;
  });
}

function canvasBlob(canvas: HTMLCanvasElement, type = "image/png", quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("相框照片编码失败")),
      type,
      quality,
    );
  });
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function triggerOriginalDownload(file: CameraFile) {
  const link = document.createElement("a");
  link.href = endpoint(file.download_url);
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function framedFilename(filename: string, extension: "png" | "jpg" | "heic") {
  const stem = filename.replace(/\.[^.]+$/, "");
  return `${stem}-framed.${extension}`;
}

async function extractGainMapJpeg(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let scanStart = -1;
  let markerOffset = 2;
  while (markerOffset + 4 <= bytes.length) {
    if (bytes[markerOffset] !== 0xff) { markerOffset += 1; continue; }
    const marker = bytes[markerOffset + 1];
    if (marker === 0xda) {
      const length = (bytes[markerOffset + 2] << 8) | bytes[markerOffset + 3];
      scanStart = markerOffset + 2 + length;
      break;
    }
    if (marker === 0xd9) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      markerOffset += 2;
      continue;
    }
    const length = (bytes[markerOffset + 2] << 8) | bytes[markerOffset + 3];
    if (length < 2) return null;
    markerOffset += length + 2;
  }
  if (scanStart < 0) return null;
  let primaryEnd = -1;
  for (let index = scanStart; index + 1 < bytes.length; index += 1) {
    if (bytes[index] === 0xff && bytes[index + 1] === 0xd9) {
      primaryEnd = index + 2;
      break;
    }
  }
  if (primaryEnd < 0) return null;
  let start = -1;
  for (let index = primaryEnd; index + 1 < bytes.length; index += 1) {
    if (bytes[index] === 0xff && bytes[index + 1] === 0xd8) {
      start = index;
      break;
    }
  }
  if (start < 0) return null;
  for (let index = start + 2; index + 1 < bytes.length; index += 1) {
    if (bytes[index] === 0xff && bytes[index + 1] === 0xd9) {
      return blob.slice(start, index + 2, "image/jpeg");
    }
  }
  return null;
}

async function encodeUltraHdr(base: Blob, gainMap: Blob, source: Blob, format: "apple" | "universal") {
  const header = new ArrayBuffer(16);
  const headerBytes = new Uint8Array(header);
  headerBytes.set(new TextEncoder().encode("I360HDR1"));
  const sizes = new DataView(header);
  sizes.setUint32(8, base.size, false);
  sizes.setUint32(12, gainMap.size, false);
  const response = await fetch(endpoint(`/api/hdr-frame?format=${format}`), {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: new Blob([header, base, gainMap, source]),
  });
  if (!response.ok) {
    let message = `HDR 封装失败 (${response.status})`;
    try { message = (await response.json()).error || message; } catch { /* binary error fallback */ }
    throw new Error(message);
  }
  return response.blob();
}

async function createFramedPhotoFromBlob(blob: Blob, details: FramedPhotoDetails): Promise<FramedPhotoExport> {
  const gainMapBlob = await extractGainMapJpeg(blob);
  const [image, exposure, gainMapImage] = await Promise.all([
    loadImage(blob),
    readExposureMetadata(blob),
    gainMapBlob ? loadImage(gainMapBlob) : Promise.resolve(null),
  ]);
  await Promise.all([
    document.fonts.load('800 48px "Frame Display"'),
    document.fonts.load('500 48px "Frame Mono"'),
    document.fonts.load('48px "Frame Script"'),
  ]);

  const sourceWidth = image.naturalWidth;
  const sourceHeight = image.naturalHeight;
  if (!sourceWidth || !sourceHeight) throw new Error("照片尺寸无效");

  // Single-photo export keeps the camera's original pixel dimensions.
  const photoWidth = sourceWidth;
  const photoHeight = sourceHeight;
  const measure = Math.max(900, Math.min(photoWidth, photoHeight));
  const side = Math.round(Math.max(48, Math.min(220, measure * 0.045)));
  const header = Math.round(Math.max(230, Math.min(820, measure * 0.20)));
  const footer = Math.round(Math.max(380, Math.min(1200, measure * 0.30)));

  const canvas = document.createElement("canvas");
  canvas.width = photoWidth + side * 2;
  canvas.height = photoHeight + header + footer;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("浏览器不支持照片合成");

  // High-contrast two-axis teal lighting. The horizontal pass makes the right
  // edge visibly brighter; the vertical pass separately lifts the lower edge.
  const background = context.createLinearGradient(0, 0, canvas.width, 0);
  background.addColorStop(0, "#061820");
  background.addColorStop(0.48, "#0d4f5a");
  background.addColorStop(1, "#2b9aa6");
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const verticalLight = context.createLinearGradient(0, 0, 0, canvas.height);
  verticalLight.addColorStop(0, "rgba(0, 3, 7, .32)");
  verticalLight.addColorStop(0.42, "rgba(0, 0, 0, 0)");
  verticalLight.addColorStop(1, "rgba(46, 174, 184, .34)");
  context.fillStyle = verticalLight;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const cornerShade = context.createRadialGradient(0, 0, 0, 0, 0, Math.max(canvas.width, canvas.height) * 0.62);
  cornerShade.addColorStop(0, "rgba(0, 5, 9, .42)");
  cornerShade.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = cornerShade;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.save();
  context.shadowColor = "rgba(0, 0, 0, .24)";
  context.shadowBlur = Math.max(12, side * 0.28);
  context.shadowOffsetY = Math.max(4, side * 0.1);
  context.fillStyle = "rgba(255,255,255,.08)";
  context.fillRect(side - 1, header - 1, photoWidth + 2, photoHeight + 2);
  context.drawImage(image, side, header, photoWidth, photoHeight);
  context.restore();

  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#ffffff";
  context.font = `750 ${Math.round(header * 0.17)}px "Frame Display", "PingFang SC", "Microsoft YaHei", sans-serif`;
  context.fillText("Insta360 Luna Ultra", canvas.width / 2, header * 0.38);

  context.font = `600 ${Math.round(header * 0.065)}px "Frame Display", sans-serif`;
  const partnerLine = "CO-ENGINEERED WITH";
  const partnerWidth = context.measureText(partnerLine).width;
  const logoSize = Math.round(header * 0.20);
  const logoGap = Math.round(header * 0.025);
  const partnerGroupWidth = partnerWidth + logoGap + logoSize;
  const partnerStart = (canvas.width - partnerGroupWidth) / 2;
  context.textAlign = "left";
  context.fillStyle = "rgba(255,255,255,.82)";
  context.fillText(partnerLine, partnerStart, header * 0.60);
  const badgeCenterX = partnerStart + partnerWidth + logoGap + logoSize / 2;
  const badgeCenterY = header * 0.60;
  context.beginPath();
  context.arc(badgeCenterX, badgeCenterY, logoSize * 0.47, 0, Math.PI * 2);
  context.fillStyle = "#e90019";
  context.fill();
  context.fillStyle = "#ffffff";
  context.font = `400 ${Math.round(logoSize * 0.39)}px "Frame Script", cursive`;
  context.textAlign = "center";
  context.fillText("Molier", badgeCenterX, badgeCenterY + logoSize * 0.035, logoSize * 0.82);
  context.textAlign = "center";

  const footerTop = header + photoHeight;
  context.fillStyle = "#ffffff";
  context.font = `400 ${Math.round(footer * 0.28)}px "Frame Script", cursive`;
  context.fillText("Luna", canvas.width / 2, footerTop + footer * 0.27);
  context.fillStyle = "rgba(255,255,255,.72)";
  context.font = `600 ${Math.round(footer * 0.043)}px "Frame Display", sans-serif`;
  context.fillText("M  O  M  E  N  T", canvas.width / 2, footerTop + footer * 0.43);

  context.fillStyle = "rgba(255,255,255,.9)";
  context.font = `550 ${Math.round(footer * 0.052)}px "Frame Mono", monospace`;
  context.fillText(exposureLine(exposure), canvas.width / 2, footerTop + footer * 0.68);
  context.fillStyle = "rgba(255,255,255,.76)";
  context.font = `500 ${Math.round(footer * 0.049)}px "Frame Mono", monospace`;
  context.fillText(exportDate(details.capturedAt), canvas.width / 2, footerTop + footer * 0.82);

  if (!gainMapBlob || !gainMapImage) return { blob: await canvasBlob(canvas), extension: "png" };

  // Build an output-sized gain map. Black means SDR brightness; brighter values
  // progressively unlock HDR headroom. The camera's own map is retained over
  // the photo while the frame, white lettering and badge receive new gain.
  const gainCanvas = document.createElement("canvas");
  gainCanvas.width = canvas.width;
  gainCanvas.height = canvas.height;
  const gain = gainCanvas.getContext("2d");
  if (!gain) throw new Error("浏览器不支持 HDR 增益图合成");
  const frameGain = gain.createLinearGradient(0, 0, gainCanvas.width, gainCanvas.height);
  frameGain.addColorStop(0, "#080808");
  frameGain.addColorStop(0.52, "#303030");
  frameGain.addColorStop(1, "#707070");
  gain.fillStyle = frameGain;
  gain.fillRect(0, 0, gainCanvas.width, gainCanvas.height);
  gain.drawImage(gainMapImage, side, header, photoWidth, photoHeight);

  gain.textAlign = "center";
  gain.textBaseline = "middle";
  gain.fillStyle = "#ffffff";
  gain.font = `750 ${Math.round(header * 0.17)}px "Frame Display", "PingFang SC", "Microsoft YaHei", sans-serif`;
  gain.fillText("Insta360 Luna Ultra", gainCanvas.width / 2, header * 0.38);
  gain.font = `600 ${Math.round(header * 0.065)}px "Frame Display", sans-serif`;
  const gainPartnerWidth = gain.measureText(partnerLine).width;
  const gainPartnerStart = (gainCanvas.width - (gainPartnerWidth + logoGap + logoSize)) / 2;
  gain.textAlign = "left";
  gain.fillText(partnerLine, gainPartnerStart, header * 0.60);
  const gainBadgeX = gainPartnerStart + gainPartnerWidth + logoGap + logoSize / 2;
  gain.beginPath();
  gain.arc(gainBadgeX, badgeCenterY, logoSize * 0.47, 0, Math.PI * 2);
  gain.fill();
  gain.font = `400 ${Math.round(logoSize * 0.39)}px "Frame Script", cursive`;
  gain.textAlign = "center";
  gain.fillText("Molier", gainBadgeX, badgeCenterY + logoSize * 0.035, logoSize * 0.82);
  gain.font = `400 ${Math.round(footer * 0.28)}px "Frame Script", cursive`;
  gain.fillText("Luna", gainCanvas.width / 2, footerTop + footer * 0.27);
  gain.font = `600 ${Math.round(footer * 0.043)}px "Frame Display", sans-serif`;
  gain.fillText("M  O  M  E  N  T", gainCanvas.width / 2, footerTop + footer * 0.43);
  gain.font = `550 ${Math.round(footer * 0.052)}px "Frame Mono", monospace`;
  gain.fillText(exposureLine(exposure), gainCanvas.width / 2, footerTop + footer * 0.68);
  gain.font = `500 ${Math.round(footer * 0.049)}px "Frame Mono", monospace`;
  gain.fillText(exportDate(details.capturedAt), gainCanvas.width / 2, footerTop + footer * 0.82);

  const [baseJpeg, gainJpeg] = await Promise.all([
    canvasBlob(canvas, "image/jpeg", 1),
    canvasBlob(gainCanvas, "image/jpeg", 0.98),
  ]);
  return {
    blob: await encodeUltraHdr(baseJpeg, gainJpeg, blob, details.hdrFormat),
    extension: details.hdrFormat === "apple" ? "heic" : "jpg",
  };
}

async function createFramedPhoto(file: CameraFile, hdrFormat: "apple" | "universal") {
  const response = await fetch(endpoint(file.media_url));
  if (!response.ok) throw new Error(`读取照片失败 (${response.status})`);
  return createFramedPhotoFromBlob(await response.blob(), {
    capturedAt: file.captured_at,
    hdrFormat,
  });
}

async function jsonRequest(path: string, init?: RequestInit) {
  const response = await fetch(endpoint(path), init);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
  return data;
}

function VideoThumbnail({ file, onReady, onError }: { file: CameraFile; onReady: () => void; onError: () => void }) {
  return (
    <video
      className="video-thumbnail"
      src={`${endpoint(file.thumbnail_url)}#t=0.12`}
      muted
      playsInline
      preload="metadata"
      onLoadedMetadata={(event) => {
        try { event.currentTarget.currentTime = 0.12; } catch { /* first frame fallback */ }
      }}
      onLoadedData={onReady}
      onSeeked={onReady}
      onError={onError}
      aria-hidden="true"
    />
  );
}

function MediaVisual({ file }: { file: CameraFile }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [active, setActive] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const browserPhoto = file.extension === "jpg" || file.extension === "jpeg" || file.extension === "insp";
  const loadable = browserPhoto || file.kind === "video";

  useEffect(() => {
    if (!loadable) return;
    const node = containerRef.current;
    if (!node || !("IntersectionObserver" in window)) {
      setActive(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setActive(true);
          observer.disconnect();
        }
      },
      { rootMargin: "1400px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadable]);

  if (!loadable) {
    return (
      <div className={`file-poster ${file.kind}`}>
        <span className="play-mark">RAW</span>
        <b>{file.extension.toUpperCase()}</b>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className={`file-poster preview-failed ${file.kind}`}>
        <span className="play-mark">{file.kind === "video" ? "▶" : "IMG"}</span>
        <b>{file.extension.toUpperCase()} 预览不可用</b>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`media-asset ${active ? "active" : "idle"} ${state === "ready" ? "ready" : "loading"}`}>
      {state === "loading" && <span className="preview-skeleton" aria-hidden="true" />}
      {active && (browserPhoto ? (
        <img
          src={endpoint(file.media_url)}
          alt=""
          loading="eager"
          decoding="async"
          onLoad={() => setState("ready")}
          onError={() => setState("error")}
        />
      ) : (
        <VideoThumbnail file={file} onReady={() => setState("ready")} onError={() => setState("error")} />
      ))}
    </div>
  );
}

function PanoramaViewer({ src, alt }: { src: string; alt: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("webgl", { antialias: true, alpha: false });
    if (!context) {
      setFailed(true);
      return;
    }
    const gl: WebGLRenderingContext = context;

    const vertexSource = `
      attribute vec2 aPosition;
      varying vec2 vUv;
      void main() {
        vUv = aPosition * 0.5 + 0.5;
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }
    `;
    const fragmentSource = `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uTexture;
      uniform float uAspect;
      uniform float uYaw;
      uniform float uPitch;
      uniform float uFov;
      const float PI = 3.141592653589793;
      void main() {
        vec2 screen = vUv * 2.0 - 1.0;
        float focal = 1.0 / tan(uFov * 0.5);
        vec3 direction = normalize(vec3(screen.x * uAspect, screen.y, focal));

        float cp = cos(uPitch);
        float sp = sin(uPitch);
        direction = vec3(direction.x, direction.y * cp - direction.z * sp, direction.y * sp + direction.z * cp);
        float cy = cos(uYaw);
        float sy = sin(uYaw);
        direction = vec3(direction.x * cy + direction.z * sy, direction.y, -direction.x * sy + direction.z * cy);

        float longitude = atan(direction.x, direction.z);
        float latitude = asin(clamp(direction.y, -1.0, 1.0));
        vec2 textureUv = vec2(longitude / (2.0 * PI) + 0.5, latitude / PI + 0.5);
        gl_FragColor = texture2D(uTexture, textureUv);
      }
    `;

    function compile(type: number, source: string) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("无法创建全景着色器");
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader) || "全景着色器编译失败");
      }
      return shader;
    }

    let program: WebGLProgram;
    try {
      program = gl.createProgram()!;
      gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("全景渲染器连接失败");
    } catch {
      setFailed(true);
      return;
    }

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "aPosition");
    const aspect = gl.getUniformLocation(program, "uAspect");
    const yawUniform = gl.getUniformLocation(program, "uYaw");
    const pitchUniform = gl.getUniformLocation(program, "uPitch");
    const fovUniform = gl.getUniformLocation(program, "uFov");
    const texture = gl.createTexture();
    let yaw = 0;
    let pitch = 0;
    let fov = Math.PI / 2.3;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let imageReady = false;

    const resize = () => {
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.floor(canvas.clientWidth * scale));
      const height = Math.max(1, Math.floor(canvas.clientHeight * scale));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    };

    const render = () => {
      if (!imageReady) return;
      resize();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(aspect, canvas.width / canvas.height);
      gl.uniform1f(yawUniform, yaw);
      gl.uniform1f(pitchUniform, pitch);
      gl.uniform1f(fovUniform, fov);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };

    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
      // Camera panoramas are usually not power-of-two textures. WebGL 1 only
      // permits CLAMP_TO_EDGE for those dimensions.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        if (gl.getError() !== gl.NO_ERROR) throw new Error("全景纹理尺寸超出显卡限制");
        imageReady = true;
        render();
      } catch {
        setFailed(true);
      }
    };
    image.onerror = () => setFailed(true);
    image.src = src;

    const onPointerDown = (event: PointerEvent) => {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add("dragging");
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      yaw -= (event.clientX - lastX) * 0.005;
      pitch = Math.max(-1.45, Math.min(1.45, pitch + (event.clientY - lastY) * 0.005));
      lastX = event.clientX;
      lastY = event.clientY;
      render();
    };
    const onPointerUp = (event: PointerEvent) => {
      dragging = false;
      canvas.classList.remove("dragging");
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      fov = Math.max(0.55, Math.min(1.7, fov + event.deltaY * 0.001));
      render();
    };
    const resizeObserver = new ResizeObserver(render);
    resizeObserver.observe(canvas);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      resizeObserver.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  }, [src]);

  if (failed) return <img src={src} alt={alt} />;
  return (
    <div className="panorama-viewer">
      <canvas ref={canvasRef} aria-label={`${alt} 的 360 度全景预览`} />
      <div className="panorama-hint"><span>360°</span>拖动改变视角 · 滚轮缩放</div>
    </div>
  );
}

function PhotoModalPreview({ file }: { file: CameraFile }) {
  const src = endpoint(file.media_url);
  const [mode, setMode] = useState<"loading" | "flat" | "panorama" | "error">("loading");

  useEffect(() => {
    const probe = new Image();
    probe.onload = () => {
      const ratio = probe.naturalWidth / Math.max(1, probe.naturalHeight);
      setMode(ratio >= 1.8 && ratio <= 2.2 ? "panorama" : "flat");
    };
    probe.onerror = () => setMode("error");
    probe.src = src;
    return () => { probe.onload = null; probe.onerror = null; };
  }, [src]);

  if (mode === "loading") return <span className="modal-loader">正在判断照片类型…</span>;
  if (mode === "error") return <div className="raw-message"><strong>照片无法预览</strong><p>可以下载原文件后使用桌面软件打开。</p></div>;
  if (mode === "panorama") return <PanoramaViewer src={src} alt={file.name} />;
  return <img src={src} alt={file.name} />;
}

export default function Home() {
  const localPhotoInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<CameraStatus>(emptyStatus);
  const [files, setFiles] = useState<CameraFile[]>([]);
  const [filter, setFilter] = useState<"all" | "photo" | "video">("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CameraFile | null>(null);
  const [page, setPage] = useState(0);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [appClosing, setAppClosing] = useState(false);
  const [frameExport, setFrameExport] = useState(false);
  const [hdrFormat, setHdrFormat] = useState<"apple" | "universal">("apple");
  const [exportProgress, setExportProgress] = useState<{ current: number; total: number; framing: boolean } | null>(null);

  async function loadFiles() {
    const data = await jsonRequest("/api/files");
    setFiles(data.files);
  }

  async function loadStatus() {
    try {
      const data = await jsonRequest("/api/status");
      setStatus(data);
      if (data.connected) await loadFiles();
      setError(null);
    } catch {
      setError("本地相机服务未启动，请通过启动脚本打开应用。 ");
    }
  }

  useEffect(() => {
    loadStatus();
    setFrameExport(window.localStorage.getItem(FRAME_EXPORT_KEY) === "1");
    setHdrFormat(window.localStorage.getItem(HDR_FORMAT_KEY) === "universal" ? "universal" : "apple");
  }, []);

  function updateFrameExport(enabled: boolean) {
    setFrameExport(enabled);
    window.localStorage.setItem(FRAME_EXPORT_KEY, enabled ? "1" : "0");
  }

  useEffect(() => {
    if (!selected) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [selected]);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const data = await jsonRequest("/api/connect", { method: "POST" });
      setStatus(data);
      await loadFiles();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "连接相机失败");
      await loadStatus();
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const data = await jsonRequest("/api/refresh", { method: "POST" });
      setStatus(data.status);
      setFiles(data.files);
      setPage(0);
      setSelectedPaths(new Set());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "刷新失败");
    } finally {
      setBusy(false);
    }
  }

  async function shutdownApp() {
    setBusy(true);
    setError(null);
    try {
      await jsonRequest("/api/shutdown", { method: "POST" });
      setStatus(emptyStatus);
      setFiles([]);
      setSelected(null);
      setSelectedPaths(new Set());
      setSelectionMode(false);
      setAppClosing(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "退出应用失败");
    } finally {
      setBusy(false);
    }
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return files.filter((file) => {
      if (filter !== "all" && file.kind !== filter) return false;
      return !needle || file.name.toLowerCase().includes(needle);
    });
  }, [files, filter, query]);

  const displayedFiles = useMemo(() => [...filtered].sort((left, right) =>
    (right.captured_at || "").localeCompare(left.captured_at || "")
  ), [filtered]);

  const totalPages = Math.max(1, Math.ceil(displayedFiles.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageFiles = displayedFiles.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const pageGroups = useMemo(() => {
    const groups = new Map<string, CameraFile[]>();
    pageFiles.forEach((file) => {
      const key = dayKey(file);
      const group = groups.get(key) || [];
      group.push(file);
      groups.set(key, group);
    });
    return Array.from(groups, ([key, items]) => ({ key, items }));
  }, [pageFiles]);

  function togglePath(path: string) {
    setSelectedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }

  function selectCurrentPage() {
    setSelectedPaths((current) => {
      const next = new Set(current);
      const allSelected = pageFiles.every((file) => next.has(file.path));
      pageFiles.forEach((file) => allSelected ? next.delete(file.path) : next.add(file.path));
      return next;
    });
  }

  function selectWholeDay(key: string) {
    const dayPaths = files.filter((file) => dayKey(file) === key).map((file) => file.path);
    setSelectedPaths((current) => {
      const next = new Set(current);
      const allSelected = dayPaths.every((path) => next.has(path));
      dayPaths.forEach((path) => allSelected ? next.delete(path) : next.add(path));
      return next;
    });
  }

  function dayIsSelected(key: string) {
    const dayFiles = files.filter((file) => dayKey(file) === key);
    return dayFiles.length > 0 && dayFiles.every((file) => selectedPaths.has(file.path));
  }

  async function downloadFile(file: CameraFile, withFrame = frameExport) {
    if (!withFrame || !frameablePhoto(file)) {
      triggerOriginalDownload(file);
      return;
    }
    setExportProgress({ current: 1, total: 1, framing: true });
    setError(null);
    try {
      const framed = await createFramedPhoto(file, hdrFormat);
      saveBlob(framed.blob, framedFilename(file.name, framed.extension));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "相框导出失败");
    } finally {
      setExportProgress(null);
    }
  }

  async function exportLocalPhoto(file: File) {
    const extension = file.name.split(".").pop()?.toLowerCase() || "photo";
    const supported = new Set(["jpg", "jpeg", "png", "webp"]);
    if (!supported.has(extension)) {
      setError("请选择 JPG、PNG 或 WebP 格式的照片");
      return;
    }

    setExportProgress({ current: 1, total: 1, framing: true });
    setError(null);
    try {
      const capturedAt = Number.isFinite(file.lastModified) && file.lastModified > 0
        ? new Date(file.lastModified).toISOString()
        : null;
      const framed = await createFramedPhotoFromBlob(file, { capturedAt, hdrFormat });
      saveBlob(framed.blob, framedFilename(file.name, framed.extension));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "本地照片加水印失败");
    } finally {
      setExportProgress(null);
    }
  }

  function mediaCard(file: CameraFile) {
    return (
      <article className={`media-card ${selectedPaths.has(file.path) ? "selected" : ""}`} key={file.path}>
        <button
          className="media-preview"
          onClick={() => selectionMode ? togglePath(file.path) : setSelected(file)}
          aria-label={selectionMode ? `选择 ${file.name}` : `预览 ${file.name}`}
        >
          <MediaVisual file={file} />
          <span className="type-badge">{file.extension.toUpperCase()}</span>
          {file.kind === "video" && !selectionMode && <span className="preview-action" aria-hidden="true">▶</span>}
          {selectionMode && (
            <span className={`selection-check ${selectedPaths.has(file.path) ? "checked" : ""}`}>
              {selectedPaths.has(file.path) ? "✓" : ""}
            </span>
          )}
        </button>
        <div className="media-meta">
          <div>
            <h3 title={file.name}>{file.name}</h3>
            <p>{formatDate(file.captured_at)}</p>
          </div>
          <button
            className={`download-icon ${frameExport && frameablePhoto(file) ? "framed" : ""}`}
            onClick={() => void downloadFile(file)}
            title={frameExport && frameablePhoto(file) ? "导出带相框照片" : "下载原文件"}
            aria-label={`下载 ${file.name}`}
            disabled={exportProgress !== null}
          >
            {frameExport && frameablePhoto(file) ? "▣" : "↓"}
          </button>
        </div>
      </article>
    );
  }

  async function downloadSelected() {
    const chosen = files.filter((file) => selectedPaths.has(file.path));
    setError(null);
    try {
      for (let index = 0; index < chosen.length; index += 1) {
        const file = chosen[index];
        setExportProgress({ current: index + 1, total: chosen.length, framing: false });
        triggerOriginalDownload(file);
        await new Promise((resolve) => window.setTimeout(resolve, 120));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "批量导出失败");
    } finally {
      setExportProgress(null);
    }
  }

  if (appClosing) {
    return (
      <main className="shutdown-screen">
        <div className="shutdown-card">
          <span className="shutdown-mark">✓</span>
          <p className="eyebrow">SAFE DISCONNECT</p>
          <h1>相机已安全断开</h1>
          <p>本地服务已经退出，现在可以直接关闭这个页面。下次使用时双击 Insta Library 图标即可。</p>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">360</span>
          <div>
            <p className="eyebrow">LOCAL CAMERA LIBRARY</p>
            <h1>Insta Library</h1>
          </div>
        </div>
        <div className={`status-pill ${status.connected ? "online" : "offline"}`}>
          <span className="status-dot" />
          {status.connected ? "相机已连接" : "等待相机"}
        </div>
      </header>

      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">READ-ONLY · DIRECT WIFI</p>
          <h2>{status.connected ? "相机素材已就绪" : "直接浏览相机里的每一帧"}</h2>
          <p>
            {status.connected
              ? `已从 ${status.camera_host} 读取 ${status.file_count} 个文件。也可以导入电脑里的照片，直接生成同款 Molier 水印相框。`
              : "连接相机 Wi‑Fi 可以浏览素材；不连接相机时，也能直接导入电脑里的照片添加 Molier 水印相框。"}
          </p>
        </div>
        <div className="hero-actions">
          <input
            ref={localPhotoInputRef}
            className="local-photo-input"
            type="file"
            accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void exportLocalPhoto(file);
            }}
          />
          <button
            type="button"
            className="local-frame-button"
            onClick={() => localPhotoInputRef.current?.click()}
            disabled={exportProgress !== null}
          >
            <span aria-hidden="true">＋</span>
            导入照片加水印
          </button>
          {status.connected ? (
            <>
              <button className="primary-button" onClick={refresh} disabled={busy}>
                {busy ? "正在读取…" : "刷新素材"}
              </button>
              <button className="text-button" onClick={shutdownApp} disabled={busy}>断开并退出</button>
            </>
          ) : (
            <>
              <button className="primary-button" onClick={connect} disabled={busy}>
                {busy ? "连接中…" : "连接相机"}
              </button>
              <button className="text-button" onClick={shutdownApp} disabled={busy}>退出应用</button>
            </>
          )}
        </div>
      </section>

      {error && <div className="error-banner"><span>!</span>{error}</div>}
      {status.connected && status.list_truncated && (
        <div className="warning-banner">
          当前相机拒绝了第 {status.verified_ucd2_limit} 个文件之后的动态 UCD2 页，只能确认前 {status.verified_ucd2_limit} 个文件；
          请保留应用日志以便继续适配该固件。
        </div>
      )}

      <section className="stats-row" aria-label="素材统计">
        <div className="stat"><strong>{status.file_count}</strong><span>全部文件</span></div>
        <div className="stat"><strong>{status.counts.photo}</strong><span>照片</span></div>
        <div className="stat"><strong>{status.counts.video}</strong><span>视频与低码率预览</span></div>
        <div className="stat read-only"><strong>只读</strong><span>安全模式始终开启</span></div>
      </section>

      <section className="library-section">
        <div className="library-toolbar">
          <div className="filter-tabs" role="tablist" aria-label="素材类型">
            {(["all", "photo", "video"] as const).map((value) => (
              <button
                key={value}
                className={filter === value ? "active" : ""}
                onClick={() => { setFilter(value); setPage(0); }}
                role="tab"
                aria-selected={filter === value}
              >
                {value === "all" ? "全部" : value === "photo" ? "照片" : "视频"}
              </button>
            ))}
          </div>
          <label className="search-box">
            <span>⌕</span>
            <input
              value={query}
              onChange={(event) => { setQuery(event.target.value); setPage(0); }}
              placeholder="搜索文件名或日期"
              aria-label="搜索素材"
            />
          </label>
          {status.connected && !selectionMode && (
            <div className="frame-export-controls">
              <label className={`frame-toggle ${frameExport ? "active" : ""}`}>
                <input
                  type="checkbox"
                  checked={frameExport}
                  onChange={(event) => updateFrameExport(event.target.checked)}
                />
                <span className="frame-toggle-art" aria-hidden="true"><i /></span>
                <span><strong>相框导出</strong><small>{frameExport ? "照片将合成相框" : "当前下载原图"}</small></span>
              </label>
              {frameExport && (
                <label className="hdr-format-select">
                  <span>HDR 格式</span>
                  <select value={hdrFormat} onChange={(event) => {
                    const value = event.target.value as "apple" | "universal";
                    setHdrFormat(value);
                    window.localStorage.setItem(HDR_FORMAT_KEY, value);
                  }}>
                    <option value="apple">iPhone · HEIC</option>
                    <option value="universal">Android · JPEG</option>
                  </select>
                </label>
              )}
            </div>
          )}
          {status.connected && (
            <div className="selection-actions">
              {selectionMode && <button className="select-page-button" onClick={selectCurrentPage}>选择本页</button>}
              <button
                className={`select-mode-button ${selectionMode ? "active" : ""}`}
                onClick={() => {
                  setSelectionMode((value) => !value);
                  if (selectionMode) setSelectedPaths(new Set());
                }}
              >
                {selectionMode ? "退出选择" : "批量选择"}
              </button>
            </div>
          )}
          <span className="result-count">{filtered.length} 项</span>
        </div>

        {!status.connected ? (
          <div className="empty-state">
            <div className="camera-shape"><span>360</span></div>
            <h3>连接相机后，素材会出现在这里</h3>
            <p>电脑无需互联网，只需连接 Insta360 相机热点。</p>
          </div>
        ) : (
          <>
            <div className="date-groups">
              {pageGroups.map(({ key, items }) => {
                const fullDayCount = files.filter((file) => dayKey(file) === key).length;
                return (
                  <section className="date-group" key={key}>
                    <div className="date-group-head">
                      <div><h3>{formatDay(key)}</h3><span>当天共 {fullDayCount} 项</span></div>
                      {selectionMode && (
                        <button className={dayIsSelected(key) ? "active" : ""} onClick={() => selectWholeDay(key)}>
                          {dayIsSelected(key) ? "取消当天全部" : "选择当天全部"}
                        </button>
                      )}
                    </div>
                    <div className="media-grid">{items.map(mediaCard)}</div>
                  </section>
                );
              })}
            </div>
            {filtered.length > 0 && (
              <nav className="pagination" aria-label="素材分页">
                <button disabled={safePage === 0} onClick={() => { setPage(safePage - 1); window.scrollTo({ top: 560, behavior: "smooth" }); }}>上一页</button>
                <span>第 <strong>{safePage + 1}</strong> / {totalPages} 页 · 每页最多 {PAGE_SIZE} 项</span>
                <button disabled={safePage >= totalPages - 1} onClick={() => { setPage(safePage + 1); window.scrollTo({ top: 560, behavior: "smooth" }); }}>下一页</button>
              </nav>
            )}
          </>
        )}
      </section>

      {selectionMode && selectedPaths.size > 0 && (
        <div className="batch-bar">
          <div><strong>{selectedPaths.size}</strong><span>已选择</span></div>
          <span className="batch-original-badge">批量仅原图</span>
          <button className="batch-secondary" onClick={selectCurrentPage}>
            {pageFiles.every((file) => selectedPaths.has(file.path)) ? "取消本页" : "选择本页"}
          </button>
          <button className="batch-secondary" onClick={() => setSelectedPaths(new Set())}>清空</button>
          <button className="primary-button" onClick={() => void downloadSelected()} disabled={exportProgress !== null}>
            {exportProgress ? `下载 ${exportProgress.current}/${exportProgress.total}` : "下载所选"}
          </button>
        </div>
      )}

      {exportProgress && (
        <div className="export-toast" role="status" aria-live="polite">
          <span className="export-spinner" aria-hidden="true" />
          <div><strong>{exportProgress.framing ? "正在生成原尺寸相框照片（自动保留 HDR）" : "正在准备原文件下载"}</strong><small>{exportProgress.current} / {exportProgress.total}</small></div>
        </div>
      )}

      {selected && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={selected.name} onMouseDown={() => setSelected(null)}>
          <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div><span>{selected.extension.toUpperCase()}</span><h2>{selected.name}</h2></div>
              <button onClick={() => setSelected(null)} aria-label="关闭预览">×</button>
            </div>
            <div className="modal-media">
              {selected.extension === "jpg" || selected.extension === "jpeg" || selected.extension === "insp" ? (
                <PhotoModalPreview file={selected} />
              ) : selected.kind === "video" ? (
                <div className="video-player-wrap">
                  <video
                    src={endpoint(selected.thumbnail_url)}
                    controls
                    autoPlay
                    playsInline
                    preload="metadata"
                  />
                  {selected.proxy_path && <span className="proxy-note">正在使用低码率代理流畅预览 · 下载仍为原文件</span>}
                </div>
              ) : (
                <div className="raw-message"><strong>RAW 文件</strong><p>浏览器无法直接显示 DNG，请下载后使用照片软件打开。</p></div>
              )}
            </div>
            <div className="modal-footer">
              <div><p>{formatDate(selected.captured_at)}</p><small>{selected.path}</small></div>
              <div className="modal-download-actions">
                <a className="modal-secondary-button" href={endpoint(selected.download_url)}>下载原文件</a>
                {frameablePhoto(selected) && (
                  <button className="primary-button" onClick={() => void downloadFile(selected, true)} disabled={exportProgress !== null}>
                    {exportProgress ? "正在生成…" : "导出带相框照片"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
