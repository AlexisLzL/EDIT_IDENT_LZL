"use client";

import React, { useMemo, useRef, useState, useEffect } from "react";
import { Stage, Layer, Image as KonvaImage, Text, Rect, Line, Circle, Group } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type { Context as KonvaContext } from "konva/lib/Context";
import type { Stage as KonvaStage } from "konva/lib/Stage";
import useImage from "use-image";
import { IneData, initialIneData } from "@/types/ine";
import { Download, Upload, Move, Check, Paintbrush, FileImage, RotateCcw, Settings, User, CreditCard, Shield, Image as ImageIcon, Layers, ChevronDown } from "lucide-react";

// Default template paths
const FRONT_TEMPLATE = "/ine-front.png";
const BACK_TEMPLATE = "/ine-back.png";

interface Position {
  x: number;
  y: number;
}

interface Point {
  x: number;
  y: number;
}

interface NormalizedPoint {
  x: number;
  y: number;
}

type CardCorners = [NormalizedPoint, NormalizedPoint, NormalizedPoint, NormalizedPoint];

const BASE_WIDTH = 660;
const BASE_HEIGHT = 440;
const FONT_FAMILY = "Arial Narrow, Arial, sans-serif";

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

const maybeRemoveWhiteBackground = (image: HTMLImageElement) => {
  if (typeof window === "undefined") return image;

  const w = image.naturalWidth || image.width;
  const h = image.naturalHeight || image.height;
  if (!w || !h) return image;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return image;

  ctx.drawImage(image, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;

  const isNearWhite = (r: number, g: number, b: number) => {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const avg = (r + g + b) / 3;
    return avg >= 238 && max - min <= 22;
  };

  const samplePoints: Array<[number, number]> = [
    [0, 0],
    [w - 1, 0],
    [w - 1, h - 1],
    [0, h - 1],
    [(w / 2) | 0, 0],
    [(w / 2) | 0, h - 1],
    [0, (h / 2) | 0],
    [w - 1, (h / 2) | 0],
    [((w * 0.1) | 0), ((h * 0.1) | 0)],
    [((w * 0.9) | 0), ((h * 0.1) | 0)],
    [((w * 0.9) | 0), ((h * 0.9) | 0)],
    [((w * 0.1) | 0), ((h * 0.9) | 0)],
  ];

  let nearWhiteSamples = 0;
  for (const [x, y] of samplePoints) {
    const i = (y * w + x) * 4;
    if (isNearWhite(data[i], data[i + 1], data[i + 2])) nearWhiteSamples++;
  }

  if (nearWhiteSamples < 7) return image;

  const visited = new Uint8Array(w * h);
  const mask = new Uint8Array(w * h);
  const qx = new Int32Array(w * h);
  const qy = new Int32Array(w * h);
  let qh = 0;
  let qt = 0;

  const tryEnqueue = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const idx = y * w + x;
    if (visited[idx]) return;
    visited[idx] = 1;
    const i = idx * 4;
    if (!isNearWhite(data[i], data[i + 1], data[i + 2])) return;
    mask[idx] = 1;
    qx[qt] = x;
    qy[qt] = y;
    qt++;
  };

  for (let x = 0; x < w; x++) {
    tryEnqueue(x, 0);
    tryEnqueue(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    tryEnqueue(0, y);
    tryEnqueue(w - 1, y);
  }

  while (qh < qt) {
    const x = qx[qh];
    const y = qy[qh];
    qh++;
    tryEnqueue(x + 1, y);
    tryEnqueue(x - 1, y);
    tryEnqueue(x, y + 1);
    tryEnqueue(x, y - 1);
  }

  let removed = 0;
  for (let i = 0; i < mask.length; i++) removed += mask[i];
  const removedRatio = removed / mask.length;
  if (removedRatio < 0.04 || removedRatio > 0.95) return image;

  for (let idx = 0; idx < mask.length; idx++) {
    if (!mask[idx]) continue;
    data[idx * 4 + 3] = 0;
  }

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      if (mask[idx]) continue;
      const i = idx * 4;
      if (!isNearWhite(data[i], data[i + 1], data[i + 2])) continue;
      const hasRemovedNeighbor =
        mask[idx - 1] || mask[idx + 1] || mask[idx - w] || mask[idx + w];
      if (!hasRemovedNeighbor) continue;
      const a = data[i + 3];
      data[i + 3] = Math.min(a, 140);
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas;
};

const createSeededRng = (seed0: number) => {
  let seed = seed0 >>> 0;
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
};

const makePrintedPhoto = (
  source: CanvasImageSource,
  opts: {
    variant: "main" | "small";
    texture?: HTMLCanvasElement | null;
    dots?: HTMLCanvasElement | null;
    seed: number;
  }
) => {
  if (typeof window === "undefined") return source;

  const w = (source as HTMLImageElement).naturalWidth ?? (source as HTMLImageElement).width;
  const h = (source as HTMLImageElement).naturalHeight ?? (source as HTMLImageElement).height;
  if (!w || !h) return source;

  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d", { willReadFrequently: true });
  if (!ctx) return source;

  if (opts.variant === "small") {
    ctx.fillStyle = "rgb(224,224,224)";
    ctx.fillRect(0, 0, w, h);
  }

  // 1. Initial soften
  const softenScale = opts.variant === "small" ? 0.55 : 0.8;
  const tmp = document.createElement("canvas");
  tmp.width = Math.max(1, Math.round(w * softenScale));
  tmp.height = Math.max(1, Math.round(h * softenScale));
  const tctx = tmp.getContext("2d", { willReadFrequently: true });
  if (!tctx) return source;

  tctx.imageSmoothingEnabled = true;
  tctx.imageSmoothingQuality = "high";
  tctx.drawImage(source, 0, 0, tmp.width, tmp.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(tmp, 0, 0, w, h);

  const img = ctx.getImageData(0, 0, w, h);
  let data = img.data;
  const rand01 = createSeededRng(opts.seed);

  // 2. Halftone effect for small ghost photo
  if (opts.variant === "small") {
    // Ghost photo with COLOR, but faded and textured
    const desat = 0.3; // Slight desaturation, not monochrome
    const contrast = 1.1;
    const brightness = 15;
    
    const applyContrast = (v: number) => (v - 128) * contrast + 128;

    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a === 0) continue;

      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];

      // Slight desaturation to match the "faded print" look
      const gray = (r + g + b) / 3;
      r = r * (1 - desat) + gray * desat;
      g = g * (1 - desat) + gray * desat;
      b = b * (1 - desat) + gray * desat;

      // Contrast & Brightness
      r = applyContrast(r) + brightness;
      g = applyContrast(g) + brightness;
      b = applyContrast(b) + brightness;

      // Clamp values
      data[i] = Math.max(0, Math.min(255, r));
      data[i + 1] = Math.max(0, Math.min(255, g));
      data[i + 2] = Math.max(0, Math.min(255, b));
    }
    ctx.putImageData(img, 0, 0);

    if (opts.dots) {
      const layer = document.createElement("canvas");
      layer.width = w;
      layer.height = h;
      const lctx = layer.getContext("2d", { willReadFrequently: true });
      if (lctx) {
        const pattern = lctx.createPattern(opts.dots, "repeat");
        if (pattern) {
          lctx.fillStyle = pattern;
          lctx.fillRect(0, 0, w, h);

          const mask = document.createElement("canvas");
          mask.width = w;
          mask.height = h;
          const mctx = mask.getContext("2d");
          if (mctx) {
            const cx = w / 2;
            const cy = h / 2;
            const radius = Math.max(w, h) * 0.8;
            const g = mctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
            // Stronger pattern visibility in center for "letras en la cara"
            g.addColorStop(0, "rgba(0,0,0,0.65)"); 
            g.addColorStop(1, "rgba(0,0,0,1)");
            mctx.fillStyle = g;
            mctx.fillRect(0, 0, w, h);

            lctx.save();
            lctx.globalCompositeOperation = "destination-in";
            lctx.drawImage(mask, 0, 0);
            lctx.restore();
          }

          ctx.save();
          // Multiply to embed text into the photo structure
          ctx.globalCompositeOperation = "multiply"; 
          ctx.globalAlpha = 0.75; // Strong visibility for text
          ctx.drawImage(layer, 0, 0);
          ctx.restore();
        }
      }
    }
  } else {
    // 3. Process Main Photo (Noise & Grading)
    // Stronger "print" look for main photo
    const desat = 0.25; // Increased desaturation
    const contrast = 1.15;
    const brightness = 5;
    const noiseAmp = 35; // Increased noise for "pixelated" grain
    
    // Pixelation Step: Downscale and Upscale
    const pixelScale = 0.6; // 60% resolution
    const smallW = Math.floor(w * pixelScale);
    const smallH = Math.floor(h * pixelScale);
    const smallC = document.createElement("canvas");
    smallC.width = smallW;
    smallC.height = smallH;
    const sctx = smallC.getContext("2d");
    if (sctx) {
        sctx.drawImage(out, 0, 0, w, h, 0, 0, smallW, smallH);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(smallC, 0, 0, smallW, smallH, 0, 0, w, h);
    }
    
    const applyContrast = (v: number) => (v - 128) * contrast + 128;

    // Refresh data after pixelation
    const pixelatedData = ctx.getImageData(0, 0, w, h);
    data = pixelatedData.data;

    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a === 0) continue;

      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];

      // Desaturate slightly
      const gray = (r + g + b) / 3;
      r = r * (1 - desat) + gray * desat;
      g = g * (1 - desat) + gray * desat;
      b = b * (1 - desat) + gray * desat;

      // Color grading (warm shift)
      r = r * 1.02;
      g = g * 0.99;
      b = b * 0.96;

      // Contrast & Brightness
      r = applyContrast(r) + brightness;
      g = applyContrast(g) + brightness;
      b = applyContrast(b) + brightness;

      // CMY Noise (colored noise looks more like print)
      const nr = (rand01() - 0.5) * noiseAmp;
      const ng = (rand01() - 0.5) * noiseAmp;
      const nb = (rand01() - 0.5) * noiseAmp;
      
      r += nr;
      g += ng;
      b += nb;

      data[i] = Math.max(0, Math.min(255, r));
      data[i + 1] = Math.max(0, Math.min(255, g));
      data[i + 2] = Math.max(0, Math.min(255, b));
    }
    ctx.putImageData(pixelatedData, 0, 0);
    
    // 4. Main Photo Micro-Grid (Simulate Dye-Sublimation Structure)
    // Replaced lines with a dot grid for "pixelated" tint
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = "rgba(0,0,0,0.8)";
    
    // Dot grid pattern
    const dotGap = 2;
    for(let y = 0; y < h; y += dotGap) {
        for(let x = 0; x < w; x += dotGap) {
             if ((x/dotGap + y/dotGap) % 2 === 0) {
                 ctx.fillRect(x, y, 1, 1);
             }
        }
    }
    ctx.restore();
  }

  // 5. Apply External Textures (if any)
  if (opts.texture) {
    const pattern = ctx.createPattern(opts.texture, "repeat");
    if (pattern) {
      ctx.save();
      ctx.globalCompositeOperation = "multiply";
      ctx.globalAlpha = opts.variant === "small" ? 0.05 : 0.08; // Lower texture for small since it has halftone
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }

  if (opts.dots && opts.variant !== 'small') { // Only main photo gets external dot overlay
    const pattern = ctx.createPattern(opts.dots, "repeat");
    if (pattern) {
      ctx.save();
      ctx.globalCompositeOperation = "multiply";
      ctx.globalAlpha = 0.15;
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }

  return out;
};

const computeHomography = (
  src: [Point, Point, Point, Point],
  dst: [Point, Point, Point, Point]
) => {
  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];

    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }

  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivotRow][col])) pivotRow = r;
    }

    const pivot = M[pivotRow][col];
    if (Math.abs(pivot) < 1e-10) return null;

    if (pivotRow !== col) {
      const tmp = M[col];
      M[col] = M[pivotRow];
      M[pivotRow] = tmp;
    }

    const invPivot = 1 / M[col][col];
    for (let c = col; c <= n; c++) M[col][c] *= invPivot;

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (Math.abs(factor) < 1e-12) continue;
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
    }
  }

  const x = M.map((row) => row[n]);
  const [a, b1, c1, d, e, f, g, h] = x;

  return {
    a,
    b: b1,
    c: c1,
    d,
    e,
    f,
    g,
    h,
  };
};

const applyHomography = (
  H:
    | {
        a: number;
        b: number;
        c: number;
        d: number;
        e: number;
        f: number;
        g: number;
        h: number;
      }
    | null,
  p: Point
): Point => {
  if (!H) return p;
  const den = H.g * p.x + H.h * p.y + 1;
  if (Math.abs(den) < 1e-10) return p;
  return {
    x: (H.a * p.x + H.b * p.y + H.c) / den,
    y: (H.d * p.x + H.e * p.y + H.f) / den,
  };
};

const initialPositions: Record<string, Position> = {
  foto: { x: 42, y: 162 },
  ghostFoto: { x: 500, y: 200 },
  
  // Top Row (Aligned with top of Name block)
  labelNombre: { x: 200, y: 172 },
  nombre: { x: 200, y: 184 },
  
  labelSexo: { x: 480, y: 172 },
  sexo: { x: 515, y: 172 }, // Value next to label

  // Middle Block
  labelDomicilio: { x: 200, y: 242 },
  domicilio: { x: 200, y: 254 },

  // Clave Elector Row
  labelClaveElector: { x: 200, y: 312 },
  claveElector: { x: 310, y: 312 }, // Same line as label

  // Bottom Block - Row 1
  labelCurp: { x: 200, y: 337 },
  curp: { x: 200, y: 349 },
  
  labelAnoRegistro: { x: 400, y: 337 },
  anoRegistro: { x: 400, y: 349 },

  // Bottom Block - Row 2
  labelFechaNacimiento: { x: 200, y: 377 },
  fechaNacimiento: { x: 200, y: 389 },
  
  labelSeccion: { x: 320, y: 377 },
  seccion: { x: 320, y: 389 },
  
  labelVigencia: { x: 400, y: 377 },
  vigencia: { x: 400, y: 389 },

  // Signatures and Back
  firma: { x: 380, y: 292 },
  ocr: { x: 50, y: 450 },
  cic: { x: 500, y: 150 },
  identificador: { x: 500, y: 180 },
  huella: { x: 50, y: 150 },
};

const IneCanvas = ({
  data,
  templateImage,
  positions,
  isEditing,
  onUpdatePosition,
  isCalibrating,
  usePerspective,
  cardCorners,
  onUpdateCorner,
  showPatches,
  patchColor,
  activeSide,
  stageRef,
  showWatermark,
}: {
  data: IneData;
  templateImage: HTMLImageElement | undefined;
  positions: Record<string, Position>;
  isEditing: boolean;
  onUpdatePosition: (key: string, x: number, y: number) => void;
  isCalibrating: boolean;
  usePerspective: boolean;
  cardCorners: CardCorners;
  onUpdateCorner: (index: 0 | 1 | 2 | 3, x: number, y: number) => void;
  showPatches: boolean;
  patchColor: string;
  activeSide: 'front' | 'back';
  stageRef: React.RefObject<KonvaStage | null>;
  showWatermark: boolean;
}) => {
  const [userPhoto] = useImage(data.foto || "");
  const [signatureImage] = useImage(data.firma || "");
  const [fingerprintImage] = useImage(data.huella || "");
  const [hologramImage] = useImage("/holograma.png");

  const processedUserPhoto = useMemo(() => {
    if (!userPhoto) return null;
    return maybeRemoveWhiteBackground(userPhoto);
  }, [userPhoto]);

  const width = templateImage?.width ?? 0;
  const height = templateImage?.height ?? 0;

  const pixelCorners = useMemo<[Point, Point, Point, Point]>(() => {
    return [
      { x: cardCorners[0].x * width, y: cardCorners[0].y * height },
      { x: cardCorners[1].x * width, y: cardCorners[1].y * height },
      { x: cardCorners[2].x * width, y: cardCorners[2].y * height },
      { x: cardCorners[3].x * width, y: cardCorners[3].y * height },
    ];
  }, [cardCorners, height, width]);

  const perspectiveEnabled = usePerspective;

  const cardScale = useMemo(() => {
    if (!perspectiveEnabled) return width / BASE_WIDTH;
    const top = distance(pixelCorners[0], pixelCorners[1]);
    const bottom = distance(pixelCorners[3], pixelCorners[2]);
    const cardWidthPx = (top + bottom) / 2;
    return cardWidthPx / BASE_WIDTH;
  }, [perspectiveEnabled, pixelCorners, width]);

  const cardRotationDeg = useMemo(() => {
    if (!perspectiveEnabled) return 0;
    const tl = pixelCorners[0];
    const tr = pixelCorners[1];
    return (Math.atan2(tr.y - tl.y, tr.x - tl.x) * 180) / Math.PI;
  }, [perspectiveEnabled, pixelCorners]);

  const baseToImage = useMemo(() => {
    if (!perspectiveEnabled) return null;
    const src: [Point, Point, Point, Point] = [
      { x: 0, y: 0 },
      { x: BASE_WIDTH, y: 0 },
      { x: BASE_WIDTH, y: BASE_HEIGHT },
      { x: 0, y: BASE_HEIGHT },
    ];
    return computeHomography(src, pixelCorners);
  }, [perspectiveEnabled, pixelCorners]);

  const imageToBase = useMemo(() => {
    if (!perspectiveEnabled) return null;
    const dst: [Point, Point, Point, Point] = [
      { x: 0, y: 0 },
      { x: BASE_WIDTH, y: 0 },
      { x: BASE_WIDTH, y: BASE_HEIGHT },
      { x: 0, y: BASE_HEIGHT },
    ];
    return computeHomography(pixelCorners, dst);
  }, [perspectiveEnabled, pixelCorners]);

  const scale = cardScale;

  const textureCanvas = useMemo(() => {
    if (typeof window === "undefined") return null;
    const c = document.createElement("canvas");
    const size = 220;
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d");
    if (!ctx) return null;

    const rand01 = createSeededRng(1337);

    // Base paper texture with subtle noise
    const base = ctx.createImageData(size, size);
    for (let i = 0; i < base.data.length; i += 4) {
      const n = (rand01() * 255) | 0;
      base.data[i] = n;
      base.data[i + 1] = n;
      base.data[i + 2] = n;
      base.data[i + 3] = 18; // Slightly more opaque for better texture
    }
    ctx.putImageData(base, 0, 0);

    // Organic blotches for paper fiber simulation
    const blotch = document.createElement("canvas");
    blotch.width = 64; // Larger for more realistic patterns
    blotch.height = 64;
    const bctx = blotch.getContext("2d");
    if (bctx) {
      const img = bctx.createImageData(blotch.width, blotch.height);
      for (let i = 0; i < img.data.length; i += 4) {
        const n = 90 + rand01() * 120; // Wider range for more variation
        img.data[i] = n;
        img.data[i + 1] = n;
        img.data[i + 2] = n;
        img.data[i + 3] = 25; // Increased opacity
      }
      bctx.putImageData(img, 0, 0);

      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.globalCompositeOperation = "overlay";
      ctx.globalAlpha = 0.35; // Reduced for more subtle effect
      
      // Multiple overlay passes for depth
      for (let i = 0; i < 3; i++) {
        ctx.drawImage(blotch, 
          (rand01() * 50) - 25, 
          (rand01() * 50) - 25, 
          size + 50, size + 50
        );
      }
      ctx.restore();
    }

    // Guilloche-style wavy structure (Generic)
    ctx.save();
    ctx.globalCompositeOperation = "multiply"; // Better blending
    ctx.globalAlpha = 0.15;
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    
    // Primary wave pattern
    for (let y = 0; y < size; y += 6) {
      ctx.beginPath();
      for (let x = 0; x < size; x += 2) {
        // Complex wave function for structural look
        const yOff = Math.sin(x * 0.05 + y * 0.1) * 3 + Math.sin(x * 0.2) * 1;
        ctx.lineTo(x, y + yOff);
      }
      ctx.stroke();
    }
    
    // Secondary interfering wave (Moire-like effect)
    ctx.globalAlpha = 0.1;
    for (let y = 0; y < size; y += 8) {
      ctx.beginPath();
      for (let x = 0; x < size; x += 3) {
        const yOff = Math.cos(x * 0.04 - y * 0.15) * 4;
        ctx.lineTo(x, y + yOff);
      }
      ctx.stroke();
    }
    ctx.restore();

    // Add subtle paper grain dots
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = 0.08;
    for (let i = 0; i < 300; i++) {
      const x = rand01() * size;
      const y = rand01() * size;
      const r = 0.5 + rand01() * 1.0;
      ctx.fillStyle = `rgba(0,0,0,${0.15 + rand01() * 0.2})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    return c;
  }, []);

  const dotCanvas = useMemo(() => {
    if (typeof window === "undefined") return null;
    const c = document.createElement("canvas");
    const size = 240;
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d");
    if (!ctx) return null;

    let seed = 424242;
    const rand01 = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    ctx.clearRect(0, 0, size, size);
    const step = 7;
    for (let y = 0; y < size; y += step) {
      for (let x = 0; x < size; x += step) {
        const jitterX = (rand01() - 0.5) * 1.2;
        const jitterY = (rand01() - 0.5) * 1.2;
        const r = 0.6 + rand01() * 0.45;
        ctx.fillStyle = `rgba(0,0,0,${0.08 + rand01() * 0.06})`;
        ctx.beginPath();
        ctx.ellipse(x + jitterX, y + jitterY, r, r, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    return c;
  }, []);


  const textPatternCanvas = useMemo(() => {
    if (typeof window === "undefined") return null;
    const c = document.createElement("canvas");
    const size = 180;
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d");
    if (!ctx) return null;

    ctx.clearRect(0, 0, size, size);
    
    // Rotate for security pattern
    ctx.save();
    ctx.translate(size/2, size/2);
    ctx.rotate(-Math.PI / 8); 
    ctx.translate(-size/2, -size/2);

    ctx.font = "900 11px Arial";
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    
    const text = "INE";
    const gap = 35;
    const lineHeight = 14;
    
    for (let y = -size; y < size * 2; y += lineHeight) {
        const offset = ((y / lineHeight) % 2) * (gap / 2);
        for (let x = -size; x < size * 2; x += gap) {
            ctx.fillText(text, x + offset, y);
        }
    }
    ctx.restore();
    
    return c;
  }, []);

  const printedUserPhotoMain = useMemo(() => {
    if (!processedUserPhoto) return null;
    return makePrintedPhoto(processedUserPhoto, {
      variant: "main",
      texture: textureCanvas,
      dots: dotCanvas,
      seed: 24680,
    });
  }, [processedUserPhoto, textureCanvas, dotCanvas]);

  const printedUserPhotoSmall = useMemo(() => {
    if (!processedUserPhoto) return null;
    return makePrintedPhoto(processedUserPhoto, {
      variant: "small",
      texture: textureCanvas,
      dots: textPatternCanvas, // Use the new text pattern
      seed: 13579,
    });
  }, [processedUserPhoto, textureCanvas, textPatternCanvas]);

  const clipRoundRect = (
    ctx: KonvaContext,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ) => {
    const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  };

  const handleDragEnd = (key: string) => (e: KonvaEventObject<DragEvent>) => {
    const px = { x: e.target.x(), y: e.target.y() };
    if (perspectiveEnabled) {
      const base = applyHomography(imageToBase, px);
      onUpdatePosition(key, base.x, base.y);
      return;
    }
    onUpdatePosition(key, px.x / scale, px.y / scale);
  };

  const handleCornerDragEnd = (index: 0 | 1 | 2 | 3) => (e: KonvaEventObject<DragEvent>) => {
    const x = clamp01(e.target.x() / width);
    const y = clamp01(e.target.y() / height);
    onUpdateCorner(index, x, y);
  };

  // Helper to render text with an optional background patch
  const renderField = (
    key: string,
    text: string,
    fontSize: number = 11,
    width?: number,
    lineHeight?: number,
    fontFamily?: string,
    isLabel: boolean = false,
    letterSpacing?: number,
    forceBold: boolean = false,
    fill?: string,
    opacity?: number,
    shadowBlurBase?: number,
    shadowOpacity?: number
  ) => {
    const baseFontSize = isLabel ? 7.4 : fontSize;
    const finalFontSize = baseFontSize * scale;
    const finalLineHeight = isLabel ? 1 : lineHeight ?? 0.95;
    const finalFontFamily = fontFamily || FONT_FAMILY;
    const fontStyle = isLabel ? "normal" : forceBold ? "bold" : "normal";
    const textColor = fill ?? (isLabel ? "#5A5A5A" : "#2A2A2A");
    const textOpacity = opacity ?? (isLabel ? 1 : 0.92);
    const shadowBlur = (shadowBlurBase ?? (isLabel ? 0 : 0.55)) * scale;
    const shadowOp = shadowOpacity ?? (isLabel ? 0 : 0.22);
    const effectiveLetterSpacingBase =
      letterSpacing ?? (isLabel ? 0 : finalFontFamily.includes("Courier") ? 0 : -0.15);

    const basePos = { x: positions[key].x, y: positions[key].y };
    const mappedPos = perspectiveEnabled
      ? applyHomography(baseToImage, basePos)
      : { x: basePos.x * scale, y: basePos.y * scale };

    const lines = text.split("\n").length || 1;
    const patchWBase = width ?? text.length * (baseFontSize * 0.6);
    const patchHBase = baseFontSize * finalLineHeight * lines;

    const patchQuad = perspectiveEnabled
      ? (() => {
          const tl = applyHomography(baseToImage, { x: basePos.x - 2, y: basePos.y - 2 });
          const tr = applyHomography(baseToImage, { x: basePos.x + patchWBase + 2, y: basePos.y - 2 });
          const br = applyHomography(baseToImage, { x: basePos.x + patchWBase + 2, y: basePos.y + patchHBase + 2 });
          const bl = applyHomography(baseToImage, { x: basePos.x - 2, y: basePos.y + patchHBase + 2 });
          return [tl, tr, br, bl];
        })()
      : null;

    return (
      <>
        {showPatches &&
          (perspectiveEnabled && patchQuad ? (
            <Line
              points={patchQuad.flatMap((p) => [p.x, p.y])}
              closed
              fill={patchColor}
              listening={false}
            />
          ) : (
            <Rect
              x={mappedPos.x - 2 * scale}
              y={mappedPos.y - 2 * scale}
              width={patchWBase * scale + 4 * scale}
              height={patchHBase * scale + 4 * scale}
              fill={patchColor}
              draggable={isEditing}
              onDragEnd={handleDragEnd(key)}
            />
          ))}
        <Text
          text={text}
          x={mappedPos.x}
          y={mappedPos.y}
          fontSize={finalFontSize}
          fontFamily={finalFontFamily}
          fontStyle={fontStyle}
          fill={textColor}
          opacity={textOpacity}
          width={width ? width * scale : undefined}
          lineHeight={finalLineHeight}
          letterSpacing={effectiveLetterSpacingBase * scale}
          rotation={perspectiveEnabled ? cardRotationDeg : 0}
          shadowColor="#000000"
          shadowBlur={shadowBlur}
          shadowOpacity={shadowOp}
          shadowOffset={{ x: 0.35 * scale, y: 0.35 * scale }}
          draggable={isEditing}
          onDragEnd={handleDragEnd(key)}
          globalCompositeOperation="multiply"
        />
      </>
    );
  };

  if (!templateImage) {
    return <div className="text-gray-500">Cargando plantilla...</div>;
  }

  const watermark = (() => {
    const items: Array<{ x: number; y: number }> = [];
    const stepX = 360;
    const stepY = 160;
    for (let y = -height; y < height * 2; y += stepY) {
      for (let x = -width; x < width * 2; x += stepX) {
        items.push({ x, y });
      }
    }
    return items;
  })();

  return (
    <Stage ref={stageRef} width={width} height={height} className="border shadow-lg bg-white">
      <Layer>
        {/* Background */}
        <KonvaImage image={templateImage} listening={false} />

        {/* Material Tint to reduce whiteness */}
        <Rect
          x={0}
          y={0}
          width={width}
          height={height}
          fill="#E8E8E5"
          opacity={0.4}
          globalCompositeOperation="multiply"
          listening={false}
        />

        {textureCanvas && (
          <KonvaImage
            image={textureCanvas}
            x={0}
            y={0}
            width={width}
            height={height}
            opacity={0.5}
            globalCompositeOperation="multiply"
            listening={false}
          />
        )}

        {showWatermark && (
          <>
            <Group rotation={-24} listening={false} opacity={0.18}>
              {watermark.map((p, i) => (
                <Text
                  key={`wm-${i}`}
                  text="SAMPLE / NO VÁLIDO"
                  x={p.x}
                  y={p.y}
                  fontSize={46}
                  fontFamily="Arial, sans-serif"
                  fontStyle="bold"
                  fill="#000000"
                  opacity={0.15}
                />
              ))}
            </Group>

            <Text
              text="SAMPLE / NO VÁLIDO"
              x={12}
              y={height - 26}
              fontSize={14}
              fontFamily="Arial, sans-serif"
              fontStyle="bold"
              fill="#111111"
              opacity={0.55}
              listening={false}
            />
          </>
        )}

        {activeSide === 'front' && (
          <>
            {/* Patches for Photos if needed */}
            {showPatches &&
              (perspectiveEnabled ? (
                (() => {
                  const basePos = { x: positions.foto.x, y: positions.foto.y };
                  const w = 130;
                  const h = 170;
                  const tl = applyHomography(baseToImage, basePos);
                  const tr = applyHomography(baseToImage, { x: basePos.x + w, y: basePos.y });
                  const br = applyHomography(baseToImage, { x: basePos.x + w, y: basePos.y + h });
                  const bl = applyHomography(baseToImage, { x: basePos.x, y: basePos.y + h });

                  return (
                    <Line
                      points={[tl, tr, br, bl].flatMap((p) => [p.x, p.y])}
                      closed
                      fill={patchColor}
                      listening={false}
                    />
                  );
                })()
              ) : (
                <Rect
                  x={positions.foto.x * scale}
                  y={positions.foto.y * scale}
                  width={130 * scale}
                  height={170 * scale}
                  fill={patchColor}
                />
              ))}

            {/* User Photo */}
            {printedUserPhotoMain && (() => {
              const basePos = { x: positions.foto.x, y: positions.foto.y };
              const mapped = perspectiveEnabled
                ? applyHomography(baseToImage, basePos)
                : { x: basePos.x * scale, y: basePos.y * scale };
              const w = 130 * scale;
              const h = 170 * scale;
              const r = 6 * scale;

              return (
                <Group
                  x={mapped.x}
                  y={mapped.y}
                  rotation={perspectiveEnabled ? cardRotationDeg : 0}
                  draggable={isEditing}
                  onDragEnd={handleDragEnd("foto")}
                  clipFunc={(ctx) => clipRoundRect(ctx, 0, 0, w, h, r)}
                >
                  <KonvaImage image={printedUserPhotoMain} x={0} y={0} width={w} height={h} opacity={0.95} />
                </Group>
              );
            })()}
            
            {/* Ghost Photo */}
            {printedUserPhotoSmall && (() => {
              const basePos = { x: positions.ghostFoto.x, y: positions.ghostFoto.y };
              const mapped = perspectiveEnabled
                ? applyHomography(baseToImage, basePos)
                : { x: basePos.x * scale, y: basePos.y * scale };
              const w = 55 * scale;
              const h = (55 * (170 / 130)) * scale;
              return (
                <Group
                  x={mapped.x}
                  y={mapped.y}
                  rotation={perspectiveEnabled ? cardRotationDeg : 0}
                  draggable={isEditing}
                  onDragEnd={handleDragEnd("ghostFoto")}
                  clipFunc={(ctx) => clipRoundRect(ctx, 0, 0, w, h, 2 * scale)}
                >
                  <KonvaImage image={printedUserPhotoSmall} x={0} y={0} width={w} height={h} opacity={0.95} globalCompositeOperation="multiply" />
                </Group>
              );
            })()}

            {/* Signature */}
            {signatureImage && (
              <KonvaImage
                image={signatureImage}
                x={
                  perspectiveEnabled
                    ? applyHomography(baseToImage, { x: positions.firma.x, y: positions.firma.y }).x
                    : positions.firma.x * scale
                }
                y={
                  perspectiveEnabled
                    ? applyHomography(baseToImage, { x: positions.firma.x, y: positions.firma.y }).y
                    : positions.firma.y * scale
                }
                width={120 * scale}
                height={60 * scale}
                rotation={perspectiveEnabled ? cardRotationDeg : 0}
                draggable={isEditing}
                onDragEnd={handleDragEnd("firma")}
                globalCompositeOperation="multiply"
              />
            )}

            {/* NOMBRE */}
            {renderField("labelNombre", "NOMBRE", undefined, undefined, undefined, undefined, true)}
            {renderField("nombre", data.nombre, 11.5, 250, 0.92, undefined, false, -0.35, false, "#2F2F2F", 0.82, 0.85, 0.22)}

            {/* DOMICILIO */}
            {renderField("labelDomicilio", "DOMICILIO", undefined, undefined, undefined, undefined, true)}
            {renderField("domicilio", data.domicilio, 9.2, 280, 0.98)}

            {/* CLAVE ELECTOR */}
            {renderField("labelClaveElector", "CLAVE DE ELECTOR", undefined, undefined, undefined, undefined, true)}
            {renderField("claveElector", data.claveElector, 9.5)}

            {/* CURP */}
            {renderField("labelCurp", "CURP", undefined, undefined, undefined, undefined, true)}
            {renderField("curp", data.curp, 9.5)}
            
            {/* AÑO REGISTRO */}
            {renderField("labelAnoRegistro", "AÑO DE REGISTRO", undefined, undefined, undefined, undefined, true)}
            {renderField("anoRegistro", data.anoRegistro, 9.5)}

            {/* FECHA DE NACIMIENTO */}
            {renderField("labelFechaNacimiento", "FECHA DE NACIMIENTO", undefined, undefined, undefined, undefined, true)}
            {renderField("fechaNacimiento", data.fechaNacimiento || "", 9.5)}

            {/* SECCIÓN */}
            {renderField("labelSeccion", "SECCIÓN", undefined, undefined, undefined, undefined, true)}
            {renderField("seccion", data.seccion, 9.5)}

            {/* VIGENCIA */}
            {renderField("labelVigencia", "VIGENCIA", undefined, undefined, undefined, undefined, true)}
            {renderField("vigencia", data.vigencia, 9.5)}

            {/* SEXO */}
            {renderField("labelSexo", "SEXO", undefined, undefined, undefined, undefined, true)}
            {renderField("sexo", data.sexo, 9.5)}

            {/* HOLOGRAM OVERLAY - EAGLE PATCH */}
            {hologramImage && (
              <KonvaImage
                image={hologramImage}
                x={80}
                y={260}
                width={200}
                height={160}
                rotation={-30}
                opacity={0.18}
                globalCompositeOperation="normal"
                draggable={isEditing}
              />
            )}
          </>
        )}

        {activeSide === 'back' && (
            <>
                {/* Fingerprint */}
                {fingerprintImage && (
                  <KonvaImage
                    image={fingerprintImage}
                    x={
                      perspectiveEnabled
                        ? applyHomography(baseToImage, { x: positions.huella.x, y: positions.huella.y }).x
                        : positions.huella.x * scale
                    }
                    y={
                      perspectiveEnabled
                        ? applyHomography(baseToImage, { x: positions.huella.x, y: positions.huella.y }).y
                        : positions.huella.y * scale
                    }
                    width={100 * scale}
                    height={120 * scale}
                    rotation={perspectiveEnabled ? cardRotationDeg : 0}
                    draggable={isEditing}
                    onDragEnd={handleDragEnd("huella")}
                    globalCompositeOperation="multiply"
                  />
                )}

                {/* CIC */}
                {renderField("cic", data.cic || '', 12)}

                {/* Identificador */}
                {renderField("identificador", data.identificador || '', 12)}

                {/* OCR */}
                {renderField("ocr", data.ocr || '', 16, 600, 1, "Courier New")}
            </>
        )}
        
      </Layer>
      {isCalibrating && (
        <Layer>
          <Line
            points={pixelCorners.flatMap((p) => [p.x, p.y])}
            closed
            stroke="#00A3FF"
            strokeWidth={2}
            dash={[8, 6]}
            listening={false}
          />
          {pixelCorners.map((p, idx) => (
            <Circle
              key={`corner-${idx}`}
              x={p.x}
              y={p.y}
              radius={10}
              fill="#00A3FF"
              opacity={0.9}
              draggable
              onDragEnd={handleCornerDragEnd(idx as 0 | 1 | 2 | 3)}
            />
          ))}
        </Layer>
      )}
    </Stage>
  );
};

export default function IneEditor() {
  const [data, setData] = useState<IneData>(initialIneData);
  const [positions, setPositions] = useState(initialPositions);
  const [isEditing, setIsEditing] = useState(false);
  const [showPatches, setShowPatches] = useState(false); // Default false for blank templates
  const [patchColor, setPatchColor] = useState("#f4e7d7"); // Default approximated color
  const [showWatermark, setShowWatermark] = useState(false);

  const [usePerspective, setUsePerspective] = useState(true);
  const [isCalibrating, setIsCalibrating] = useState(false);

  // Responsive Canvas State
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasScale, setCanvasScale] = useState(1);

  // Accordion State
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    assets: true,
    data: true,
    forensics: true
  });

  const toggleSection = (section: string) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const fullCorners: CardCorners = useMemo(
    () => [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    []
  );

  const refCorners: CardCorners = useMemo(
    () => [
      { x: 290 / 1280, y: (160 + 28) / 720 },
      { x: 1050 / 1280, y: (135 + 28) / 720 },
      { x: 1065 / 1280, y: (590 + 28) / 720 },
      { x: 275 / 1280, y: (610 + 28) / 720 },
    ],
    []
  );

  const [frontCardCorners, setFrontCardCorners] = useState<CardCorners>(fullCorners);
  const [backCardCorners, setBackCardCorners] = useState<CardCorners>(fullCorners);
  
  const [activeSide, setActiveSide] = useState<'front' | 'back'>('front');
  const [frontTemplateSrc, setFrontTemplateSrc] = useState(FRONT_TEMPLATE);
  const [backTemplateSrc, setBackTemplateSrc] = useState(BACK_TEMPLATE);
  
  const [frontTemplateImage] = useImage(frontTemplateSrc);
  const [backTemplateImage] = useImage(backTemplateSrc);
  
  const templateImage = activeSide === 'front' ? frontTemplateImage : backTemplateImage;

  const stageRef = useRef<KonvaStage | null>(null);

  // Auto-fit canvas to container
  useEffect(() => {
    const updateScale = () => {
        if (!containerRef.current || !templateImage) return;
        
        // Use natural dimensions if available, otherwise defaults
        const imgW = templateImage.width || 660;
        const imgH = templateImage.height || 440;
        
        const { clientWidth, clientHeight } = containerRef.current;
        const padding = 48; // Space for padding
        
        const availableW = clientWidth - padding;
        const availableH = clientHeight - padding;
        
        const scaleW = availableW / imgW;
        const scaleH = availableH / imgH;
        
        // Fit to screen, but allow upscaling if screen is large enough, maxing out at reasonable zoom
        const newScale = Math.min(scaleW, scaleH);
        setCanvasScale(newScale * 0.95); // 95% of max fit for breathing room
    };

    updateScale();
    window.addEventListener('resize', updateScale);
    
    // Add a small delay to ensure layout is computed
    const timeout = setTimeout(updateScale, 100);
    
    return () => {
        window.removeEventListener('resize', updateScale);
        clearTimeout(timeout);
    };
  }, [templateImage, activeSide]);

  const isFullCorners = (corners: CardCorners) =>
    corners.every(
      (p, i) => Math.abs(p.x - fullCorners[i].x) < 1e-6 && Math.abs(p.y - fullCorners[i].y) < 1e-6
    );

  const displayedCardCorners: CardCorners =
    activeSide === "front"
      ? templateImage && templateImage.width === 1280 && templateImage.height === 720 && isFullCorners(frontCardCorners)
        ? refCorners
        : frontCardCorners
      : backCardCorners;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setData((prev) => ({ ...prev, [name]: value }));
  };

  const handleTemplateUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        if (activeSide === 'front') {
            setFrontTemplateSrc(reader.result as string);
            setFrontCardCorners(fullCorners);
        } else {
            setBackTemplateSrc(reader.result as string);
            setBackCardCorners(fullCorners);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        setData((prev) => ({ ...prev, foto: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSignatureUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        setData((prev) => ({ ...prev, firma: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleFingerprintUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        setData((prev) => ({ ...prev, huella: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleUpdatePosition = (key: string, x: number, y: number) => {
    setPositions((prev) => ({ ...prev, [key]: { x, y } }));
  };

  const handleUpdateCorner = (index: 0 | 1 | 2 | 3, x: number, y: number) => {
    if (activeSide === "front") {
      setFrontCardCorners((prev) => {
        const next: CardCorners = [...prev] as CardCorners;
        next[index] = { x, y };
        return next;
      });
      return;
    }
    setBackCardCorners((prev) => {
      const next: CardCorners = [...prev] as CardCorners;
      next[index] = { x, y };
      return next;
    });
  };

  const handleDownload = () => {
    const stage = stageRef.current;
    if (!stage) return;

    const link = document.createElement("a");
    link.download = `credencial-sample-${activeSide}.jpg`;
    link.href = stage.toDataURL({ mimeType: "image/jpeg", quality: 0.9, pixelRatio: 2 });
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="grid grid-cols-12 gap-6 h-[calc(100vh-8rem)]">
      {/* Sidebar - Scrollable */}
      <div className="col-span-12 lg:col-span-4 flex flex-col gap-5 overflow-y-auto pr-2 custom-scrollbar">
        
        {/* Actions Bar */}
        <div className="bg-slate-900/80 backdrop-blur-sm rounded-xl p-4 shadow-xl border border-slate-800 flex justify-between items-center group hover:border-slate-700 transition-colors">
            <div className="flex gap-2">
                 <button
                    onClick={() => setActiveSide(activeSide === 'front' ? 'back' : 'front')}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 hover:text-white transition-all text-sm font-medium border border-slate-700 text-slate-400 shadow-sm"
                 >
                    <RotateCcw size={16}/>
                    {activeSide === 'front' ? 'Ver Reverso' : 'Ver Frente'}
                 </button>
            </div>
            <button
                onClick={() => setIsEditing(!isEditing)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all border shadow-lg ${
                    isEditing 
                    ? 'bg-blue-600 border-blue-500 text-white shadow-blue-500/20 scale-105' 
                    : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}
            >
                {isEditing ? <Check size={16}/> : <Move size={16}/>}
                {isEditing ? 'Finalizar' : 'Mover'}
            </button>
        </div>

        {/* Section: Assets */}
        <div className="bg-slate-900/80 backdrop-blur-sm rounded-xl shadow-xl border border-slate-800 hover:border-slate-700 transition-colors">
            <button 
                onClick={() => toggleSection('assets')}
                className="w-full bg-slate-800/50 px-4 py-3 border-b border-slate-800 flex items-center justify-between group cursor-pointer hover:bg-slate-800/80 transition-colors rounded-t-xl"
            >
                <div className="flex items-center gap-3">
                    <div className="p-1.5 bg-blue-500/10 rounded-md">
                        <ImageIcon size={16} className="text-blue-400" />
                    </div>
                    <h3 className="font-bold text-slate-200 text-xs tracking-wider uppercase">Recursos Gráficos</h3>
                </div>
                <ChevronDown size={16} className={`text-slate-400 transition-transform duration-300 ${openSections.assets ? 'rotate-180' : ''}`} />
            </button>
            {openSections.assets && (
                <div className="animate-in slide-in-from-top-1 duration-200 border-t border-slate-800/50">
                    <div className="p-5 space-y-5">
                        {/* Background Upload */}
                        <div>
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">
                                Fondo ({activeSide === 'front' ? 'Frente' : 'Reverso'})
                            </label>
                            <div className="flex gap-2">
                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={handleTemplateUpload}
                                    className="hidden"
                                    id="template-upload"
                                />
                                <label htmlFor="template-upload" className="flex-1 cursor-pointer flex items-center justify-center gap-2 px-4 py-3 bg-slate-950 border border-dashed border-slate-700 text-slate-400 rounded-lg hover:bg-slate-800 hover:border-blue-500/50 hover:text-blue-400 transition-all text-sm font-medium group">
                                    <Upload size={16} className="group-hover:scale-110 transition-transform"/>
                                    Subir Plantilla
                                </label>
                            </div>
                        </div>

                        {activeSide === 'front' ? (
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">Fotografía</label>
                                    <input type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" id="photo-upload" />
                                    <label htmlFor="photo-upload" className="cursor-pointer flex flex-col items-center justify-center gap-3 px-2 py-4 bg-slate-950 border border-slate-800 text-slate-400 rounded-lg hover:bg-slate-800 hover:border-blue-500/50 hover:text-blue-400 hover:shadow-lg transition-all text-xs font-medium text-center h-28 group">
                                        <div className="p-2 bg-slate-900 rounded-full group-hover:bg-blue-500/10 transition-colors">
                                            <User size={20} className="text-slate-500 group-hover:text-blue-400"/>
                                        </div>
                                        Cambiar Foto
                                    </label>
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">Firma</label>
                                    <input type="file" accept="image/*" onChange={handleSignatureUpload} className="hidden" id="signature-upload" />
                                    <label htmlFor="signature-upload" className="cursor-pointer flex flex-col items-center justify-center gap-3 px-2 py-4 bg-slate-950 border border-slate-800 text-slate-400 rounded-lg hover:bg-slate-800 hover:border-blue-500/50 hover:text-blue-400 hover:shadow-lg transition-all text-xs font-medium text-center h-28 group">
                                        <div className="p-2 bg-slate-900 rounded-full group-hover:bg-blue-500/10 transition-colors">
                                            <Paintbrush size={20} className="text-slate-500 group-hover:text-blue-400"/>
                                        </div>
                                        Cambiar Firma
                                    </label>
                                </div>
                            </div>
                        ) : (
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">Huella Dactilar</label>
                                <input type="file" accept="image/*" onChange={handleFingerprintUpload} className="hidden" id="fingerprint-upload" />
                                <label htmlFor="fingerprint-upload" className="cursor-pointer flex items-center justify-center gap-2 px-4 py-4 bg-slate-950 border border-slate-800 text-slate-400 rounded-lg hover:bg-slate-800 hover:border-blue-500/50 hover:text-blue-400 hover:shadow-lg transition-all text-sm font-medium group">
                                    <Upload size={16} className="group-hover:scale-110 transition-transform"/>
                                    Subir Huella
                                </label>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>

        {/* Section: Data */}
        <div className="bg-slate-900/80 backdrop-blur-sm rounded-xl shadow-xl border border-slate-800 hover:border-slate-700 transition-colors">
            <button 
                onClick={() => toggleSection('data')}
                className="w-full bg-slate-800/50 px-4 py-3 border-b border-slate-800 flex items-center justify-between group cursor-pointer hover:bg-slate-800/80 transition-colors rounded-t-xl"
            >
                <div className="flex items-center gap-3">
                    <div className="p-1.5 bg-emerald-500/10 rounded-md">
                        <CreditCard size={16} className="text-emerald-400" />
                    </div>
                    <h3 className="font-bold text-slate-200 text-xs tracking-wider uppercase">Datos del Ciudadano</h3>
                </div>
                <ChevronDown size={16} className={`text-slate-400 transition-transform duration-300 ${openSections.data ? 'rotate-180' : ''}`} />
            </button>
            {openSections.data && (
                <div className="animate-in slide-in-from-top-1 duration-200 border-t border-slate-800/50">
                    <div className="p-5 space-y-5">
                        {activeSide === 'front' ? (
                            <>
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Nombre Completo</label>
                                    <textarea
                                    name="nombre"
                                    value={data.nombre}
                                    onChange={handleInputChange}
                                    rows={4}
                                    className="w-full rounded-lg border-slate-700 bg-slate-800 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-all p-3 text-sm font-medium text-white placeholder-slate-400 shadow-sm"
                                    placeholder="APELLIDO PATERNO MATERNO NOMBRE(S)"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Domicilio</label>
                                    <textarea
                                    name="domicilio"
                                    value={data.domicilio}
                                    onChange={handleInputChange}
                                    rows={4}
                                    className="w-full rounded-lg border-slate-700 bg-slate-800 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-all p-3 text-sm font-medium text-white placeholder-slate-400 shadow-sm"
                                    placeholder="CALLE NUMERO COLONIA CP MUNICIPIO ESTADO"
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    {[
                                        { label: 'Clave Elector', name: 'claveElector' },
                                        { label: 'CURP', name: 'curp' },
                                        { label: 'Año Registro', name: 'anoRegistro' },
                                        { label: 'Sección', name: 'seccion' },
                                        { label: 'Vigencia', name: 'vigencia' },
                                        { label: 'Sexo', name: 'sexo' },
                                    ].map((field) => (
                                        <div key={field.name}>
                                            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{field.label}</label>
                                            <input
                                                type="text"
                                                name={field.name}
                                                value={data[field.name as keyof IneData]}
                                                onChange={handleInputChange}
                                                className="w-full rounded-lg border-slate-700 bg-slate-800 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-all p-2.5 text-sm font-medium text-white placeholder-slate-400 shadow-sm"
                                            />
                                        </div>
                                    ))}
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="space-y-4">
                                    {[
                                        { label: 'CIC', name: 'cic' },
                                        { label: 'Identificador Ciudadano', name: 'identificador' },
                                    ].map((field) => (
                                        <div key={field.name}>
                                            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{field.label}</label>
                                            <input
                                                type="text"
                                                name={field.name}
                                                value={data[field.name as keyof IneData]}
                                                onChange={handleInputChange}
                                                className="w-full rounded-lg border-slate-700 bg-slate-800 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-all p-2.5 text-sm font-medium text-white placeholder-slate-400 shadow-sm"
                                            />
                                        </div>
                                    ))}
                                    <div>
                                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">OCR</label>
                                        <textarea
                                        name="ocr"
                                        value={data.ocr}
                                        onChange={handleInputChange}
                                        rows={4}
                                        className="w-full rounded-lg border-slate-700 bg-slate-800 focus:bg-slate-900 focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-all p-3 text-sm font-mono text-slate-300 tracking-tight placeholder-slate-400 shadow-sm"
                                        />
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>

        {/* Section: Forensics */}
        <div className="bg-slate-900/80 backdrop-blur-sm rounded-xl shadow-xl border border-slate-800 hover:border-slate-700 transition-colors">
            <button 
                onClick={() => toggleSection('forensics')}
                className="w-full bg-slate-800/50 px-4 py-3 border-b border-slate-800 flex items-center justify-between group cursor-pointer hover:bg-slate-800/80 transition-colors rounded-t-xl"
            >
                <div className="flex items-center gap-3">
                    <div className="p-1.5 bg-amber-500/10 rounded-md">
                        <Shield size={16} className="text-amber-400" />
                    </div>
                    <h3 className="font-bold text-slate-200 text-xs tracking-wider uppercase">Herramientas Forenses</h3>
                </div>
                <ChevronDown size={16} className={`text-slate-400 transition-transform duration-300 ${openSections.forensics ? 'rotate-180' : ''}`} />
            </button>
            {openSections.forensics && (
                <div className="animate-in slide-in-from-top-1 duration-200 border-t border-slate-800/50">
                    <div className="p-5 space-y-4">
                        <div className="flex items-center justify-between p-3.5 bg-slate-950 rounded-lg border border-slate-800">
                            <span className="text-sm font-medium text-slate-300">Limpiar Fondo (Parches)</span>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" checked={showPatches} onChange={(e) => setShowPatches(e.target.checked)} className="sr-only peer" />
                                <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-400 after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-600 peer-checked:after:bg-white peer-checked:after:border-white"></div>
                            </label>
                        </div>
                        {showPatches && (
                            <div className="flex items-center gap-3 p-3 bg-slate-950/50 rounded-lg border border-slate-800/50">
                                <label className="text-xs font-bold text-slate-500 uppercase">Color Base</label>
                                <div className="flex-1 h-8 rounded-md overflow-hidden border border-slate-700 relative">
                                    <input type="color" value={patchColor} onChange={(e) => setPatchColor(e.target.value)} className="absolute -top-2 -left-2 w-[200%] h-[200%] cursor-pointer p-0 m-0" />
                                </div>
                            </div>
                        )}
                        
                        <div className="flex items-center justify-between p-3.5 bg-slate-950 rounded-lg border border-slate-800">
                            <span className="text-sm font-medium text-slate-300">Corrección de Perspectiva</span>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" checked={usePerspective} onChange={(e) => { const enabled = e.target.checked; setUsePerspective(enabled); if (!enabled) setIsCalibrating(false); }} className="sr-only peer" />
                                <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-400 after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-600 peer-checked:after:bg-white peer-checked:after:border-white"></div>
                            </label>
                        </div>
                        {usePerspective && (
                            <div className="flex gap-2">
                                <button
                                onClick={() => setIsCalibrating((v) => !v)}
                                className={`flex-1 px-3 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wide transition-all ${isCalibrating ? "bg-amber-600 text-white shadow-lg shadow-amber-600/20" : "bg-slate-950 border border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white"}`}
                                >
                                {isCalibrating ? "Terminar Calibración" : "Calibrar Puntos"}
                                </button>
                                <button
                                onClick={() => {
                                    if (activeSide === "front") {
                                    if (templateImage && templateImage.width === 1280 && templateImage.height === 720) { setFrontCardCorners(refCorners); } else { setFrontCardCorners(fullCorners); }
                                    } else { setBackCardCorners(fullCorners); }
                                }}
                                className="px-4 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wide bg-slate-950 border border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white transition-all"
                                >
                                Reset
                                </button>
                            </div>
                        )}

                        <div className="flex items-center justify-between p-3.5 bg-slate-950 rounded-lg border border-slate-800">
                            <span className="text-sm font-medium text-slate-300">Marca de Agua (Sample)</span>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" checked={showWatermark} onChange={(e) => setShowWatermark(e.target.checked)} className="sr-only peer" />
                                <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-400 after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-600 peer-checked:after:bg-white peer-checked:after:border-white"></div>
                            </label>
                        </div>
                    </div>
                </div>
            )}
        </div>

        {/* Download Button */}
        <button
            onClick={handleDownload}
            className="w-full mt-2 flex items-center justify-center gap-3 bg-gradient-to-r from-emerald-600 to-emerald-500 text-white py-4 rounded-xl hover:from-emerald-500 hover:to-emerald-400 transition-all font-bold shadow-lg shadow-emerald-900/20 active:scale-[0.98] transform border border-emerald-500/20 group"
        >
            <Download size={20} className="group-hover:animate-bounce"/>
            EXPORTAR ALTA RESOLUCIÓN
        </button>
        <div className="text-center pb-8 pt-2">
            <span className="text-[10px] text-slate-600 font-mono tracking-[0.2em] uppercase">Secure Render Engine v2.1</span>
        </div>

      </div>

      {/* Preview Area */}
      <div className="col-span-12 lg:col-span-8 bg-slate-900 rounded-2xl border border-slate-800 relative overflow-hidden flex flex-col shadow-2xl">
         {/* Toolbar */}
         <div className="absolute top-4 left-4 right-4 z-10 flex justify-between items-center pointer-events-none">
            <div className="bg-slate-800/90 backdrop-blur text-xs font-mono text-slate-400 px-3 py-1.5 rounded-full border border-slate-700 pointer-events-auto">
                CANVAS: {activeSide.toUpperCase()} • {templateImage?.width || 0}x{templateImage?.height || 0}px • {(canvasScale * 100).toFixed(0)}%
            </div>
            {isEditing && (
                <div className="bg-blue-600/90 backdrop-blur text-xs font-bold text-white px-4 py-1.5 rounded-full shadow-lg shadow-blue-500/20 animate-pulse pointer-events-auto">
                    MODO EDICIÓN ACTIVO
                </div>
            )}
         </div>

         {/* Canvas Container */}
         <div ref={containerRef} className="flex-1 flex items-center justify-center p-8 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px] overflow-hidden">
            <div 
                style={{ 
                    transform: `scale(${canvasScale})`,
                    transformOrigin: 'center center',
                    transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)' 
                }} 
                className="relative shadow-2xl rounded-lg overflow-hidden ring-1 ring-slate-700/50"
            >
                <IneCanvas 
                    data={data} 
                    templateImage={templateImage} 
                    positions={positions}
                    isEditing={isEditing}
                    onUpdatePosition={handleUpdatePosition}
                    isCalibrating={isCalibrating}
                    usePerspective={usePerspective}
                    cardCorners={displayedCardCorners}
                    onUpdateCorner={handleUpdateCorner}
                    showPatches={showPatches}
                    patchColor={patchColor}
                    activeSide={activeSide}
                    stageRef={stageRef}
                    showWatermark={showWatermark}
                />
            </div>
         </div>
      </div>
    </div>
  );
}
